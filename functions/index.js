'use strict';

const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp({
  projectId: 'class-divide',
  databaseURL: 'https://class-divide-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const options = {
  region: 'asia-southeast1',
  timeoutSeconds: 30,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 2,
  concurrency: 4,
};
// App Check is not enforced until the web app has been registered/configured for it.
// Authentication and authorization below are always required, independently of App Check.
const WINDOW_MS = 10 * 60 * 1000;
const INVALID_CODE = '방 코드 또는 복구 코드를 확인해주세요.';
const fail = (code, message) => ({ error: { code, message } });
const ok = () => ({ success: true });

function caller(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', '인증 후 다시 시도해주세요.');
  const code = typeof request.data?.roomCode === 'string' ? request.data.roomCode.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) throw new HttpsError('invalid-argument', '방 코드를 확인해주세요.');
  return { uid: request.auth.uid, code };
}
function isAdmin(root, code, uid) {
  const member = root.roomMembers?.[code]?.[uid];
  return member?.active === true && member.role === 'admin';
}
function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}
function digest(code, instanceId, version, token) {
  return fingerprint(JSON.stringify(['classdivide-admin-recovery-v1', code, instanceId, version, token]));
}
function matches(expected, actual) {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
function validSecret(room, secret) {
  return typeof room?.recoveryInstanceId === 'string' && secret?.instanceId === room.recoveryInstanceId
    && secret.status === 'active' && Number.isSafeInteger(secret.version) && secret.version >= 1;
}
function secretValue(code, instanceId, version, token, uid, now) {
  return { instanceId, version, hash: digest(code, instanceId, version, token), status: 'active', issuedAt: now, issuedBy: uid };
}

// All authority changes, code rotation and deletion commit together at their common RTDB ancestor.
// This intentionally avoids a read/compare followed by a non-conditional multi-path update.
// The root transaction can contend with other rooms; keep recovery rare and bounded. No root data is returned/logged.
async function atomic(reducer) {
  let outcome;
  let result;
  try {
    result = await getDatabase().ref().transaction(current => {
      // The SDK may first provide null from its cache. Returning an object lets the server
      // compare/retry against authoritative data instead of aborting on that initial cache miss.
      const root = current || {};
      outcome = reducer(root);
      return root;
    }, undefined, false);
  } catch {
    throw new HttpsError('unavailable', '처리 결과를 확인하지 못했습니다. 관리자 재입장을 먼저 확인한 뒤 다시 시도해주세요.');
  }
  if (!result.committed || !outcome) throw new HttpsError('unavailable', '잠시 후 다시 시도해주세요.');
  if (outcome.error) throw new HttpsError(outcome.error.code, outcome.error.message);
}

exports.issueAdminRecoveryCode = onCall(options, async request => {
  const { code, uid } = caller(request);
  const replaceExisting = request.data?.replaceExisting === true;
  const token = randomBytes(32).toString('base64url');
  const newInstance = randomBytes(16).toString('hex');
  const now = Date.now();
  let version;
  await atomic(root => {
    const room = root.classdivide_workspaces?.[code];
    if (!room || !isAdmin(root, code, uid)) return fail('permission-denied', '현재 방의 관리자만 복구 코드를 발급할 수 있습니다.');
    const previous = root.roomSecrets?.[code];
    if (validSecret(room, previous)) {
      if (!replaceExisting) return fail('already-exists', '이미 발급된 코드가 있습니다. 관리자 화면에서 재발급해주세요.');
      if (now - previous.issuedAt < 10000) return fail('resource-exhausted', '코드를 방금 발급했습니다. 10초 후 다시 시도해주세요.');
    }
    const instanceId = room.recoveryInstanceId || newInstance;
    version = validSecret(room, previous) ? previous.version + 1 : 1;
    if (!Number.isSafeInteger(version)) return fail('failed-precondition', '운영자 확인이 필요합니다.');
    room.recoveryInstanceId = instanceId;
    root.roomSecrets ||= {};
    root.roomSecrets[code] = secretValue(code, instanceId, version, token, uid, now);
    root.roomRecovery ||= {};
    // Preserve current rate-limit history when rotating; issuance must not reset a lockout.
    root.roomRecovery[code] = { ...root.roomRecovery[code], lastAction: 'issued', lastActionAt: now, lastActor: uid };
    return ok();
  });
  // Plaintext exists only in this invocation and its single successful response.
  return { roomCode: code, recoveryCode: token, version };
});

exports.recoverWorkspaceAdmin = onCall(options, async request => {
  const { code, uid } = caller(request);
  const token = typeof request.data?.recoveryCode === 'string' ? request.data.recoveryCode.trim() : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpsError('invalid-argument', INVALID_CODE);
  const nextToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  const uidHash = fingerprint(uid);
  // Use the platform request IP, not a client-supplied IP field or forwarded header.
  const ipHash = fingerprint(request.rawRequest?.ip || 'unknown');
  let version;
  await atomic(root => {
    const room = root.classdivide_workspaces?.[code];
    const secret = root.roomSecrets?.[code];
    if (!validSecret(room, secret)) return fail('permission-denied', INVALID_CODE);
    const state = root.roomRecovery?.[code] || {};
    const attempts = (Array.isArray(state.attempts) ? state.attempts : [])
      .filter(event => event && event.at > now - WINDOW_MS);
    if (attempts.length >= 30 || attempts.filter(e => e.uidHash === uidHash).length >= 5
      || attempts.filter(e => e.ipHash === ipHash).length >= 15) {
      return fail('resource-exhausted', '복구 시도가 많습니다. 최대 10분 후 다시 시도해주세요.');
    }
    root.roomRecovery ||= {};
    root.roomRecovery[code] = { ...state, attempts: [...attempts, { at: now, uidHash, ipHash }] };
    if (!matches(secret.hash, digest(code, secret.instanceId, secret.version, token))) {
      // Failed attempts commit the counter but never change membership or secrets.
      return fail('permission-denied', INVALID_CODE);
    }
    version = secret.version + 1;
    if (!Number.isSafeInteger(version)) return fail('failed-precondition', '운영자 확인이 필요합니다.');
    root.roomMembers ||= {};
    root.roomMembers[code] ||= {};
    root.roomMembers[code][uid] = { role: 'admin', active: true, classNum: 0 };
    if (root.roomJoinRequests?.[code]) delete root.roomJoinRequests[code][uid];
    root.roomSecrets[code] = secretValue(code, secret.instanceId, version, nextToken, uid, now);
    Object.assign(root.roomRecovery[code], { lastAction: 'recovered', lastActionAt: now, lastActor: uid });
    return ok();
  });
  // A retry with the old code cannot add another UID. If this response is lost, the same
  // authenticated browser remains admin and may explicitly issue a replacement code.
  return { roomCode: code, recoveryCode: nextToken, version };
});

exports.deleteWorkspaceSecure = onCall(options, async request => {
  const { code, uid } = caller(request);
  await atomic(root => {
    if (!root.classdivide_workspaces?.[code] || !isAdmin(root, code, uid)) {
      return fail('permission-denied', '현재 방의 관리자만 삭제할 수 있습니다.');
    }
    for (const key of ['classdivide_workspaces', 'roomMembers', 'roomJoinRequests', 'roomSecrets', 'roomRecovery']) {
      if (root[key]) delete root[key][code];
    }
    return ok();
  });
  return { deleted: true };
});
