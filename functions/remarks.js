'use strict';

const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

const REMARKS_PATH = 'classdivide_student_remarks';
const MAX_REMARK_LENGTH = 5000;
const fail = (code, message) => ({ error: { code, message } });

// 행 삭제·정렬로 바뀌는 화면 ID를 제외하고 이름·원래 번호 등으로 학생을 구분합니다.
function studentIdentity(student) {
  return createHash('sha256').update(JSON.stringify([
    student.현학급, String(student.이름 || ''), String(student.번호 ?? ''),
    String(student.생년월일 || ''), String(student.학년 ?? '')
  ])).digest('hex');
}

function studentsInRoom(room) {
  if (room.classInputs && typeof room.classInputs === 'object') {
    return Object.entries(room.classInputs).sort(([a], [b]) => Number(a) - Number(b))
      .flatMap(([classNum, rows]) => Object.values(rows || {}).filter(Boolean).map((student, index) => ({
        ...student, id: Number(classNum) * 1000000 + index + 1, 현학급: Number(classNum)
      })));
  }
  // 과거 학생 배열만 있는 방도 기존 자료를 바꾸거나 삭제하지 않고 읽습니다.
  return Object.values(room.students || {}).filter(Boolean);
}

function memberAccess(root, code, uid) {
  const room = root.classdivide_workspaces?.[code];
  const member = root.roomMembers?.[code]?.[uid];
  if (!room || member?.active !== true || !['admin', 'teacher'].includes(member.role)) {
    return fail('permission-denied', '이 방의 승인된 권한이 필요합니다.');
  }
  return { room, member };
}

function encryptionKey(getKey) {
  const secret = getKey();
  const key = typeof secret === 'string' ? Buffer.from(secret, 'base64') : Buffer.alloc(0);
  if (key.length !== 32 || key.toString('base64') !== secret) {
    throw new Error('비고 암호화 설정을 확인해주세요.');
  }
  return key;
}

// 방·학급·학생 지문을 암호문에 결합하여 다른 학생으로 복사된 암호문도 거부합니다.
function aad(code, classNum, identity, version) {
  return Buffer.from(JSON.stringify([code, classNum, identity, version]));
}
function encrypt(text, code, classNum, identity, version, getKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(getKey), iv);
  cipher.setAAD(aad(code, classNum, identity, version));
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { identity, version, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decrypt(record, code, classNum, identity, getKey) {
  if (record.identity !== identity || !Number.isSafeInteger(record.version) || record.version < 1) {
    throw new Error('저장된 비고 정보를 확인하지 못했습니다.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(getKey), Buffer.from(record.iv, 'base64'));
  decipher.setAAD(aad(code, classNum, identity, record.version));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function savedRecord(root, code, student, getKey) {
  const identity = studentIdentity(student);
  const saved = root[REMARKS_PATH]?.[code]?.[student.현학급]?.[identity];
  return {
    identity,
    version: saved?.version || 0,
    text: saved ? decrypt(saved, code, student.현학급, identity, getKey) : String(student.비고 ?? '')
  };
}

function listRemarks(root, code, uid, getKey) {
  const access = memberAccess(root, code, uid);
  if (access.error) return access;
  const notes = {};
  const identities = new Set();
  for (const student of studentsInRoom(access.room)) {
    const key = `${student.현학급}:${student.id}`;
    const identity = studentIdentity(student);
    if (notes[key] || identities.has(identity)) return fail('failed-precondition', '중복된 학생 식별자가 있습니다. 학급 명단을 확인해주세요.');
    identities.add(identity);
    notes[key] = savedRecord(root, code, student, getKey);
  }
  return { notes };
}

function updateRemark(root, code, uid, input, getKey, now = Date.now()) {
  const access = memberAccess(root, code, uid);
  if (access.error) return access;
  const { room, member } = access;
  if (member.role !== 'admin' || room.hostId !== uid) {
    return fail('permission-denied', '학급을 생성한 교사만 비고를 수정할 수 있습니다.');
  }
  const { classNum, studentId, identity, expectedVersion, expectedText, text } = input || {};
  if (!Number.isSafeInteger(classNum) || classNum < 1 || classNum > room.currentClassCount
    || !Number.isSafeInteger(studentId) || typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || typeof expectedText !== 'string' || typeof text !== 'string' || text.length > MAX_REMARK_LENGTH) {
    return fail('invalid-argument', `학생 정보를 확인하고 비고를 ${MAX_REMARK_LENGTH}자 이내로 입력해주세요.`);
  }
  if (room.step !== 1 || room.classStatus?.[classNum]?.completed === true) {
    return fail('failed-precondition', '마감된 학급의 비고는 수정할 수 없습니다.');
  }
  const students = studentsInRoom(room);
  if (new Set(students.map(studentIdentity)).size !== students.length) {
    return fail('failed-precondition', '중복된 학생 식별자가 있습니다. 학급 명단을 확인해주세요.');
  }
  const matches = students.filter(student => student.현학급 === classNum && student.id === studentId);
  if (matches.length !== 1 || studentIdentity(matches[0]) !== identity) {
    return fail('aborted', '학생 명단이 변경되었습니다. 최신 명단을 확인한 뒤 다시 수정해주세요.');
  }
  const current = savedRecord(root, code, matches[0], getKey);
  if (current.version !== expectedVersion || current.text !== expectedText) {
    return fail('aborted', '다른 화면에서 비고가 변경되었습니다. 입력한 내용을 보관하고 최신 비고를 확인해주세요.');
  }
  const version = expectedVersion + 1;
  if (!Number.isSafeInteger(version)) return fail('failed-precondition', '저장된 비고 버전을 확인해주세요.');
  // 검증과 암호화를 모두 마친 뒤 해당 학생의 비고와 동기화 시각만 바꿉니다.
  const record = encrypt(text, code, classNum, identity, version, getKey);
  root[REMARKS_PATH] ||= {};
  root[REMARKS_PATH][code] ||= {};
  root[REMARKS_PATH][code][classNum] ||= {};
  root[REMARKS_PATH][code][classNum][identity] = record;
  room.updatedAt = Math.max(now, Number(room.updatedAt || 0) + 1);
  return { text, version, identity };
}

module.exports = { REMARKS_PATH, MAX_REMARK_LENGTH, studentIdentity, studentsInRoom, listRemarks, updateRemark };
