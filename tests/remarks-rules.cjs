// 실제 운영 접속을 차단하고 로컬 RTDB 에뮬레이터에서만 보안 규칙을 검사합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:19000';
const project = process.env.GCLOUD_PROJECT || 'demo-classdivide-remarks';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address) || !/^demo-[a-z0-9-]+$/.test(project)) {
  throw new Error('시험은 localhost와 demo 프로젝트에서만 실행할 수 있습니다.');
}
const roomCode = 'FAKE_RULES_ROOM';
const workspacePath = `classdivide_workspaces/${roomCode}`;
const notesPath = `classdivide_student_remarks/${roomCode}`;
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${project}`, aud: project,
    auth_time: now, user_id: uid, sub: uid, iat: now, exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'custom' }
  })}.`;
}
async function request(method, location, value, user) {
  const url = new URL(`http://${address}/${location}.json`);
  url.searchParams.set('ns', project);
  if (user && user !== 'owner') url.searchParams.set('auth', token(user));
  const response = await fetch(url, {
    method,
    headers: {
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(user === 'owner' ? { Authorization: 'Bearer owner' } : {})
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(10000)
  });
  return { status: response.status, body: await response.json() };
}
async function denied(method, location, value, user) {
  const response = await request(method, location, value, user);
  assert.ok([401, 403].includes(response.status), `${user || '미인증'} ${method} ${location}: 접근 거부 필요, 실제 ${response.status}`);
}
// Firebase는 숫자 키 객체를 빈 자리에 null이 있는 배열로 반환할 수 있습니다.
// 배열의 빈 자리만 생략해 키 구조를 맞추고 모든 실제 키·값은 그대로 비교합니다.
function normalizeFirebase(value) {
  if (Array.isArray(value)) return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, normalizeFirebase(item)]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, normalizeFirebase(item)]));
  return value;
}
(async () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8'));
  assert.equal((await request('PUT', '.settings/rules', rules, 'owner')).status, 200, '현재 규칙을 로컬 시험 namespace에만 적용');
  const workspace = {
    code: roomCode, name: '가상 규칙 시험', hostId: 'creator', currentClassCount: 1,
    nextClassCount: 1, reductionCount: 0, placementOrder: 'zigzag', step: 1, updatedAt: 1,
    classStatus: { 1: { completed: false } },
    classInputs: { 1: [{ id: 1000001, 이름: '학생A', 현학급: 1 }] }
  };
  const notes = { 1: { fakeIdentity: { ciphertext: '가상 암호문', version: 1 } } };
  const seed = {
    classdivide_workspaces: { [roomCode]: workspace },
    roomMembers: { [roomCode]: {
      creator: { role: 'admin', active: true, classNum: 0 },
      teacher: { role: 'teacher', active: true, classNum: 1 }
    } },
    classdivide_student_remarks: { [roomCode]: notes }
  };
  assert.equal((await request('PUT', '', seed, 'owner')).status, 200, '에뮬레이터 관리자 시드');
  assert.equal((await request('GET', workspacePath, undefined, 'teacher')).status, 200, '기존 승인 참여자의 명단 열람 유지');
  assert.equal((await request('PUT', `${workspacePath}/updatedAt`, 2, 'creator')).status, 200, '기존 관리자 권한 유지');
  for (const uid of [undefined, 'creator', 'teacher', 'unknown']) {
    await denied('GET', notesPath, undefined, uid);
    await denied('PUT', `${notesPath}/1/fakeIdentity`, { ciphertext: '교체 시도' }, uid);
    await denied('DELETE', notesPath, undefined, uid);
  }
  await denied('PATCH', '', { [notesPath]: { overwritten: true }, [`${workspacePath}/updatedAt`]: 3 }, 'creator');
  assert.deepEqual(normalizeFirebase((await request('GET', notesPath, undefined, 'owner')).body), normalizeFirebase(notes), '거부된 쓰기 뒤 비고 원본 유지');
  assert.equal((await request('GET', `${workspacePath}/updatedAt`, undefined, 'owner')).body, 2, '복수 경로 쓰기 거부의 원자성');
  assert.equal((await request('PUT', `${workspacePath}/classStatus/1/completed`, true, 'owner')).status, 200);
  await denied('PUT', `${notesPath}/1/fakeIdentity`, { ciphertext: '마감 후 시도' }, 'creator');
  console.log('PASS 실제 RTDB 규칙: 승인 참여자 기존 열람, 관리자 기존 쓰기, 신규 비고 직접 읽기·쓰기·삭제 차단, 복수 경로 우회 차단, 거부 원자성, 마감 후 직접 쓰기 차단');
})().catch(error => { console.error(error); process.exitCode = 1; });
