// 가상 학생과 시험 전용 암호화 키로 서버 권한·충돌·암호화 동작을 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REMARKS_PATH, listRemarks, updateRemark } = require('../functions/remarks');
const key = () => Buffer.alloc(32, 7).toString('base64');
const code = 'FAKE_ROOM';
function fixture() {
  return {
    classdivide_workspaces: { [code]: {
      hostId: 'creator', step: 1, currentClassCount: 2, updatedAt: 10,
      classStatus: { 1: { completed: false }, 2: { completed: false } },
      classInputs: {
        1: [
          { id: 1000001, 이름: '학생A', 현학급: 1, 번호: 1, 학년: 5, 생년월일: '', 비고: '원래 비고', 배정학급: '가', 학습부진: true },
          { id: 1000002, 이름: '학생B', 현학급: 1, 번호: 2, 학년: 5, 생년월일: '' }
        ],
        2: [{ id: 2000001, 이름: '학생C', 현학급: 2, 번호: 1, 학년: 5 }]
      },
      result: { assignments: { 가: [{ id: 1000001, 이름: '학생A', 배정학급: '가' }] } }
    } },
    roomMembers: { [code]: {
      creator: { active: true, role: 'admin', classNum: 0 },
      teacher: { active: true, role: 'teacher', classNum: 1 },
      recovered: { active: true, role: 'admin', classNum: 0 },
      revoked: { active: false, role: 'admin', classNum: 0 }
    } },
    roomRecovery: { [code]: { lastAction: 'issued', lastActor: 'creator' } },
    unrelated: { retained: true }
  };
}
function input(root, classNum = 1, studentId = 1000001, text = '새 비고\n두 번째 줄') {
  const note = listRemarks(root, code, 'creator', key).notes[`${classNum}:${studentId}`];
  return { classNum, studentId, identity: note.identity, expectedVersion: note.version, expectedText: note.text, text };
}
function unchangedFailure(root, uid, value, expectedCode) {
  const before = JSON.stringify(root);
  assert.equal(updateRemark(root, code, uid, value, key).error.code, expectedCode);
  assert.equal(JSON.stringify(root), before, '저장 거부 시 모든 데이터 유지');
}
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('생성자 저장·여러 줄·암호화·단일 학생 변경·재조회·참여자 동기화', () => {
  const root = fixture();
  const previous = structuredClone(root);
  const request = input(root);
  const saved = updateRemark(root, code, 'creator', request, key, 11);
  assert.deepEqual(saved, { text: request.text, identity: request.identity, version: 1 });
  assert.equal(root.classdivide_workspaces[code].updatedAt, 11);
  assert.deepEqual(root.classdivide_workspaces[code].classInputs, previous.classdivide_workspaces[code].classInputs);
  assert.deepEqual(root.classdivide_workspaces[code].result, previous.classdivide_workspaces[code].result);
  assert.deepEqual(root.roomMembers, previous.roomMembers);
  assert.deepEqual(root.roomRecovery, previous.roomRecovery);
  assert.deepEqual(root.unrelated, previous.unrelated);
  assert.equal(Object.keys(root[REMARKS_PATH][code][1]).length, 1);
  assert.ok(!JSON.stringify(root[REMARKS_PATH]).includes(request.text));
  const refreshed = JSON.parse(JSON.stringify(root));
  assert.deepEqual(listRemarks(refreshed, code, 'teacher', key).notes['1:1000001'], saved);
  assert.equal(listRemarks(refreshed, code, 'teacher', key).notes['1:1000002'].text, '');
});

test('비어 있는 비고 입력 및 전체 삭제도 버전 증가와 함께 유지', () => {
  const root = fixture();
  const request = input(root, 1, 1000002, '새 내용');
  assert.equal(request.expectedVersion, 0);
  assert.equal(request.expectedText, '');
  assert.equal(updateRemark(root, code, 'creator', request, key).version, 1);
  const clear = input(root, 1, 1000002, '');
  assert.equal(updateRemark(root, code, 'creator', clear, key).version, 2);
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000002'].text, '');
});

test('참여 교사·권한 해제·복구 관리자·미가입자 수정 거부', () => {
  for (const uid of ['teacher', 'revoked', 'recovered', 'unknown']) {
    const root = fixture();
    unchangedFailure(root, uid, input(root), 'permission-denied');
  }
  const root = fixture();
  root.roomMembers[code].creator.active = 1;
  unchangedFailure(root, 'creator', input(fixture()), 'permission-denied');
  assert.equal(listRemarks(root, code, 'unknown', key).error.code, 'permission-denied');
});

test('학급별 완료 및 전체 배정 마감 후 수정 거부', () => {
  const root = fixture();
  const request = input(root);
  root.classdivide_workspaces[code].classStatus[1].completed = true;
  unchangedFailure(root, 'creator', request, 'failed-precondition');
  root.classdivide_workspaces[code].classStatus[1].completed = false;
  root.classdivide_workspaces[code].step = 3;
  unchangedFailure(root, 'creator', request, 'failed-precondition');
});

test('동일 학생 동시 수정 충돌은 먼저 저장한 내용 보존', () => {
  const root = fixture();
  const first = input(root);
  const second = { ...first, text: '경쟁 수정' };
  updateRemark(root, code, 'creator', first, key);
  unchangedFailure(root, 'creator', second, 'aborted');
  assert.equal(listRemarks(root, code, 'creator', key).notes['1:1000001'].text, first.text);
});

test('서로 다른 학생의 동시 비고 저장은 모두 유지', () => {
  const root = fixture();
  const a = input(root);
  const b = input(root, 2, 2000001, '별도 학생 비고');
  updateRemark(root, code, 'creator', a, key);
  updateRemark(root, code, 'creator', b, key);
  const notes = listRemarks(root, code, 'creator', key).notes;
  assert.equal(notes['1:1000001'].text, a.text);
  assert.equal(notes['2:2000001'].text, b.text);
});

test('학생 행 재사용 및 최초 비고 재업로드 충돌 거부', () => {
  const root = fixture();
  const request = input(root);
  root.classdivide_workspaces[code].classInputs[1][0].이름 = '학생D';
  unchangedFailure(root, 'creator', request, 'aborted');
  const fresh = fixture();
  const beforeUpload = input(fresh);
  fresh.classdivide_workspaces[code].classInputs[1][0].비고 = '새 업로드 내용';
  unchangedFailure(fresh, 'creator', beforeUpload, 'aborted');
});

test('새 학생에게 이전 학생의 암호화 비고를 노출하지 않음', () => {
  const root = fixture();
  updateRemark(root, code, 'creator', input(root), key);
  root.classdivide_workspaces[code].classInputs[1][0].이름 = '학생D';
  root.classdivide_workspaces[code].classInputs[1][0].비고 = '새 학생 비고';
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].text, '새 학생 비고');
});

test('앞행 삭제 이후 기존 학생의 비고 유지 및 옛 화면 저장 거부', () => {
  const root = fixture();
  updateRemark(root, code, 'creator', input(root, 1, 1000002, '학생B의 비고'), key);
  const beforeDelete = input(root, 1, 1000002, '옛 화면 변경');
  root.classdivide_workspaces[code].classInputs[1].shift();
  const notes = listRemarks(root, code, 'teacher', key).notes;
  assert.equal(notes['1:1000001'].text, '학생B의 비고');
  assert.equal(notes['1:1000001'].version, 1);
  assert.equal(notes['1:1000002'], undefined);
  unchangedFailure(root, 'creator', beforeDelete, 'aborted');
  assert.equal(updateRemark(root, code, 'creator', input(root, 1, 1000001, '삭제 후 수정'), key).version, 2);
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].text, '삭제 후 수정');
});

test('행 재정렬 이후 학생별 비고 유지 및 편집 도중 행 이동 충돌', () => {
  const root = fixture();
  updateRemark(root, code, 'creator', input(root, 1, 1000001, '학생A 비고'), key);
  updateRemark(root, code, 'creator', input(root, 1, 1000002, '학생B 비고'), key);
  const beforeSort = input(root, 1, 1000001, '정렬 전 화면 변경');
  root.classdivide_workspaces[code].classInputs[1].reverse();
  const notes = listRemarks(root, code, 'teacher', key).notes;
  assert.equal(notes['1:1000001'].text, '학생B 비고');
  assert.equal(notes['1:1000002'].text, '학생A 비고');
  unchangedFailure(root, 'creator', beforeSort, 'aborted');
});

test('정체성 메타데이터가 완전히 같은 학생은 비고 공유 없이 조회·저장 거부', () => {
  const root = fixture();
  const beforeDuplicate = input(root);
  root.classdivide_workspaces[code].classInputs[1].push({
    ...root.classdivide_workspaces[code].classInputs[1][0], id: 1000003
  });
  assert.equal(listRemarks(root, code, 'teacher', key).error.code, 'failed-precondition');
  unchangedFailure(root, 'creator', beforeDuplicate, 'failed-precondition');
});

test('잘못된 입력·학생 삭제·암호화 설정 실패 시 데이터 보존', () => {
  const root = fixture();
  const valid = input(root);
  for (const patch of [{ text: 'x'.repeat(5001) }, { text: 10 }, { expectedText: undefined }, { expectedVersion: -1 }, { classNum: 0 }, { identity: 'bad' }]) {
    unchangedFailure(root, 'creator', { ...valid, ...patch }, 'invalid-argument');
  }
  const before = JSON.stringify(root);
  assert.throws(() => updateRemark(root, code, 'creator', valid, () => 'invalid-key'));
  assert.equal(JSON.stringify(root), before);
  root.classdivide_workspaces[code].classInputs[1] = [];
  unchangedFailure(root, 'creator', valid, 'aborted');
});

test('암호문 변조 및 다른 학생으로 암호문 복사 거부', () => {
  const root = fixture();
  const request = input(root);
  updateRemark(root, code, 'creator', request, key);
  const stored = root[REMARKS_PATH][code][1][request.identity];
  stored.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => listRemarks(root, code, 'creator', key));
  const other = fixture();
  const a = input(other);
  const b = input(other, 1, 1000002);
  updateRemark(other, code, 'creator', a, key);
  other[REMARKS_PATH][code][1][b.identity] = {
    ...other[REMARKS_PATH][code][1][a.identity], identity: b.identity
  };
  assert.throws(() => listRemarks(other, code, 'creator', key));
});

test('과거 students 배열 및 기존 비고 호환', () => {
  const root = fixture();
  const room = root.classdivide_workspaces[code];
  room.students = room.classInputs[1];
  delete room.classInputs;
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].text, '원래 비고');
  assert.equal(updateRemark(root, code, 'creator', input(root), key).version, 1);
});

test('별도 비고 저장 경로는 기존 DB 규칙의 기본 거부 경로', () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8')).rules;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.equal(rules[REMARKS_PATH], undefined);
  assert.deepEqual(Object.keys(rules).filter(name => name.startsWith('$')), [], '최상위 와일드카드 허용 없음');
  assert.ok(!REMARKS_PATH.startsWith('classdivide_workspaces/'), '관리자 쓰기 허용 경로의 하위가 아님');
});

test('callable 연결·해당 방만 조회·인증·트랜잭션 저장 통합 검사', async () => {
  let root = fixture();
  const reads = [];
  const transactions = [];
  class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const database = { ref(location = '') {
    return {
      async get() {
        reads.push(location);
        const value = location.split('/').filter(Boolean).reduce((at, part) => at?.[part], root);
        return { val: () => structuredClone(value ?? null) };
      },
      async transaction(reducer) {
        transactions.push(location);
        const value = reducer(structuredClone(root));
        if (value === undefined) return { committed: false };
        root = value;
        return { committed: true };
      }
    };
  } };
  const callableExports = {};
  const load = name => {
    if (name === 'node:crypto') return require(name);
    if (name === 'firebase-admin/app') return { initializeApp() {} };
    if (name === 'firebase-admin/database') return { getDatabase: () => database };
    if (name === 'firebase-functions/v2/https') return { onCall: (_options, handler) => handler, HttpsError: FakeHttpsError };
    if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: key }) };
    if (name === './remarks') return require('../functions/remarks');
    throw new Error(`예상하지 못한 의존성: ${name}`);
  };
  const source = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
  new Function('require', 'exports', source)(load, callableExports);
  const request = { auth: { uid: 'creator' }, data: { roomCode: code } };
  const initial = await callableExports.listStudentRemarks(request);
  assert.equal(initial.notes['1:1000001'].text, '원래 비고');
  assert.deepEqual(reads, [
    `roomMembers/${code}/creator`, `classdivide_workspaces/${code}`, `${REMARKS_PATH}/${code}`
  ]);
  await assert.rejects(callableExports.listStudentRemarks({ data: { roomCode: code } }), error => error.code === 'unauthenticated');
  reads.length = 0;
  await assert.rejects(callableExports.listStudentRemarks({ auth: { uid: 'unknown' }, data: { roomCode: code } }), error => error.code === 'permission-denied');
  assert.deepEqual(reads, [`roomMembers/${code}/unknown`], '미승인 요청에는 학생 명단·비고를 조회하지 않음');
  const change = { roomCode: code, ...input(root) };
  const response = await callableExports.updateStudentRemark({ auth: { uid: 'creator' }, data: change });
  assert.equal(response.text, change.text);
  assert.equal(response.version, 1);
  assert.deepEqual(transactions, [''], '권한·학급·비고를 같은 원자 트랜잭션에서 검증');
  const before = JSON.stringify(root);
  await assert.rejects(callableExports.updateStudentRemark({ auth: { uid: 'teacher' }, data: change }), error => error.code === 'permission-denied');
  assert.equal(JSON.stringify(root), before);
  const reread = await callableExports.listStudentRemarks({ auth: { uid: 'teacher' }, data: { roomCode: code } });
  assert.equal(reread.notes['1:1000001'].text, change.text);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}`, error); }
  }
  console.log(`${cases.length - failed}/${cases.length}개 서버 비고 검사 통과`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
