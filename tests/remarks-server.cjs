// 가상 학생과 시험 전용 암호화 키로 서버 권한·충돌·암호화 동작을 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REMARKS_PATH, listRemarks, updateRemark, studentDetails } = require('../functions/remarks');
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
function detailsInput(root, changes = {}, classNum = 1, studentId = 1000001) {
  const request = input(root, classNum, studentId);
  const note = listRemarks(root, code, 'creator', key).notes[`${classNum}:${studentId}`];
  return { ...request, text: note.text, expectedDetails: structuredClone(note.details), details: { ...note.details, ...changes } };
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
  assert.deepEqual(saved, { text: request.text, identity: request.identity, version: 1,
    details: studentDetails(previous.classdivide_workspaces[code].classInputs[1][0]) });
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

test('권한이 해제된 관리자·교사와 미가입자의 수정 거부', () => {
  for (const uid of ['revoked', 'unknown']) {
    const root = fixture();
    unchangedFailure(root, uid, input(root), 'permission-denied');
  }
  for (const uid of ['creator', 'teacher', 'recovered']) {
    for (const active of [false, 1, 'true', undefined]) {
      const root = fixture();
      const request = input(root);
      root.roomMembers[code][uid].active = active;
      unchangedFailure(root, uid, request, 'permission-denied');
    }
  }
  assert.equal(listRemarks(fixture(), code, 'unknown', key).error.code, 'permission-denied');
});

test('승인된 담임은 본인 학급의 메모·구조화 항목을 수정하고 다른 반·원본·협업 기록 보존', () => {
  const root = fixture();
  const previous = structuredClone(root);
  const memo = input(root, 1, 1000001, '담임이 직접 수정한 메모');
  const first = updateRemark(root, code, 'teacher', memo, key);
  assert.equal(first.text, memo.text);
  assert.equal(first.version, 1);
  const details = detailsInput(root, { 학습부진: false, 생활지도: '중', 분리배정: '담임이 수정한 요청' });
  const second = updateRemark(root, code, 'teacher', details, key);
  assert.equal(second.version, 2);
  assert.equal(second.details.학습부진, false);
  assert.equal(second.details.생활지도, '중');
  assert.equal(second.text, memo.text);
  assert.deepEqual(listRemarks(root, code, 'creator', key).notes['1:1000001'], second);
  assert.equal(root[REMARKS_PATH][code][2], undefined, '다른 반의 저장 경로는 만들지 않음');
  assert.deepEqual(root.classdivide_workspaces[code].classInputs, previous.classdivide_workspaces[code].classInputs);
  assert.deepEqual(root.classdivide_workspaces[code].result, previous.classdivide_workspaces[code].result);
  assert.deepEqual(root.roomMembers, previous.roomMembers);
  assert.deepEqual(root.roomRecovery, previous.roomRecovery);
  assert.ok(!JSON.stringify(root[REMARKS_PATH]).includes(memo.text));
  assert.ok(!JSON.stringify(root[REMARKS_PATH]).includes(details.details.분리배정));
});

test('관리자와 복구된 관리자는 hostId와 관계없이 모든 반의 메모·특이사항 수정 허용', () => {
  for (const uid of ['creator', 'recovered']) {
    for (const [classNum, studentId] of [[1, 1000001], [2, 2000001]]) {
      const root = fixture();
      const memo = input(root, classNum, studentId, `${uid}의 ${classNum}반 메모`);
      assert.equal(updateRemark(root, code, uid, memo, key).text, memo.text);
      const details = detailsInput(root, { 생활지도: '상', 학생선수: true }, classNum, studentId);
      const saved = updateRemark(root, code, uid, details, key);
      assert.equal(saved.details.생활지도, '상');
      assert.equal(saved.details.학생선수, true);
      assert.equal(saved.version, 2);
      assert.equal(root.classdivide_workspaces[code].hostId, 'creator', '기존 생성자 정보 보존');
      assert.deepEqual(listRemarks(root, code, 'teacher', key).notes[`${classNum}:${studentId}`], saved);
    }
  }
});

test('담임의 다른 반 수정과 학급번호·학생 ID 조합 위조는 저장 거부', () => {
  const root = fixture();
  const own = input(root);
  const other = input(root, 2, 2000001, '다른 반 위조 수정');
  unchangedFailure(root, 'teacher', other, 'permission-denied');
  unchangedFailure(root, 'teacher', detailsInput(root, { 생활지도: '상' }, 2, 2000001), 'permission-denied');
  unchangedFailure(root, 'teacher', { ...other, classNum: 1 }, 'aborted');
  unchangedFailure(root, 'teacher', { ...own, classNum: 2 }, 'permission-denied');
  unchangedFailure(root, 'teacher', { ...own, studentId: 2000001, identity: other.identity }, 'aborted');
});

test('담임의 잘못된 소속 학급 형식은 숫자 변환 없이 모두 권한 거부', () => {
  for (const classNum of ['1', 0, NaN, 2.5, -1, 3, Infinity, null, undefined]) {
    const root = fixture();
    const memo = input(root);
    const details = detailsInput(root, { 생활지도: '상' });
    root.roomMembers[code].teacher.classNum = classNum;
    unchangedFailure(root, 'teacher', memo, 'permission-denied');
    unchangedFailure(root, 'teacher', details, 'permission-denied');
  }
});

test('조회 후 담당 학급 변경·권한 해제 시 이전 화면의 저장은 거부', () => {
  for (const action of ['changed-class', 'revoked', 'removed']) {
    const root = fixture();
    const memo = input(root);
    const note = listRemarks(root, code, 'teacher', key).notes['1:1000001'];
    assert.equal(note.identity, memo.identity);
    const details = detailsInput(root, { 생활지도: '상' });
    if (action === 'changed-class') root.roomMembers[code].teacher.classNum = 2;
    else if (action === 'revoked') root.roomMembers[code].teacher.active = false;
    else delete root.roomMembers[code].teacher;
    unchangedFailure(root, 'teacher', memo, 'permission-denied');
    unchangedFailure(root, 'teacher', details, 'permission-denied');
    if (action === 'changed-class') {
      const newlyAssigned = input(root, 2, 2000001, '바뀐 담당 반');
      assert.equal(updateRemark(root, code, 'teacher', newlyAssigned, key).text, newlyAssigned.text);
    }
  }
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

test('엑셀의 기존 특이사항을 읽고 한 학생의 구조화 수정만 암호화·동기화', () => {
  const root = fixture();
  const room = root.classdivide_workspaces[code];
  Object.assign(room.classInputs[1][0], {
    생활지도: '중', 학생선수: true, 통합학급: true, 학부모민원: true,
    쌍둥이: true, 쌍둥이옵션: '동일', 전출예정: true, 분리배정: '2반 가상학생C'
  });
  const before = structuredClone(root);
  const initial = listRemarks(root, code, 'teacher', key).notes['1:1000001'];
  assert.deepEqual(initial.details, {
    학습부진: true, 생활지도: '중', 학생선수: true, 통합학급: true, 학부모민원: true,
    쌍둥이: true, 쌍둥이옵션: '동일', 전출예정: true, 분리배정: '2반 가상학생C'
  });
  const request = detailsInput(root, { 학습부진: false, 생활지도: '하', 분리배정: '구조화 수정 전용 값' });
  const saved = updateRemark(root, code, 'creator', request, key, 20);
  assert.equal(saved.version, 1);
  assert.equal(saved.text, '원래 비고');
  assert.deepEqual(saved.details, request.details);
  assert.equal(root[REMARKS_PATH][code][1][request.identity].format, 2);
  assert.ok(!JSON.stringify(root[REMARKS_PATH]).includes('구조화 수정 전용 값'));
  assert.deepEqual(room.classInputs, before.classdivide_workspaces[code].classInputs);
  assert.deepEqual(room.result, before.classdivide_workspaces[code].result);
  assert.deepEqual(root.roomMembers, before.roomMembers);
  assert.deepEqual(root.roomRecovery, before.roomRecovery);
  assert.deepEqual(root.unrelated, before.unrelated);
  assert.deepEqual(listRemarks(JSON.parse(JSON.stringify(root)), code, 'teacher', key).notes['1:1000001'], saved);
  assert.deepEqual(listRemarks(root, code, 'teacher', key).notes['1:1000002'],
    listRemarks(before, code, 'teacher', key).notes['1:1000002']);
});

test('구조화 항목 입력의 잘못된 형식·추가 신원필드·누락된 비교값 거부', () => {
  const root = fixture();
  const valid = detailsInput(root, { 생활지도: '상' });
  const partial = { ...valid.details };
  delete partial.학습부진;
  for (const details of [null, [], partial,
    { ...valid.details, 학습부진: 'O' }, { ...valid.details, 생활지도: '최상' },
    { ...valid.details, 쌍둥이옵션: '같은반' }, { ...valid.details, 분리배정: 123 },
    { ...valid.details, 분리배정: 'x'.repeat(1001) },
    { ...valid.details, 이름: '다른 학생' }, { ...valid.details, id: 999 },
    { ...valid.details, 쌍둥이: false, 쌍둥이옵션: '동일' }]) {
    unchangedFailure(root, 'creator', { ...valid, details }, 'invalid-argument');
  }
  for (const expectedDetails of [undefined, null, partial, { ...valid.expectedDetails, 전출예정: 'false' }]) {
    unchangedFailure(root, 'creator', { ...valid, expectedDetails }, 'invalid-argument');
  }
});

test('구조화 수정도 비활성 사용자·미가입자 및 마감 학급에서 저장 차단', () => {
  for (const uid of ['revoked', 'unknown']) {
    const root = fixture();
    unchangedFailure(root, uid, detailsInput(root, { 생활지도: '상' }), 'permission-denied');
  }
  for (const uid of ['creator', 'recovered', 'teacher']) {
    for (const state of ['class', 'room']) {
      const root = fixture();
      const request = detailsInput(root, { 생활지도: '상' });
      const memo = input(root);
      if (state === 'class') root.classdivide_workspaces[code].classStatus[1].completed = true;
      else root.classdivide_workspaces[code].step = 3;
      unchangedFailure(root, uid, request, 'failed-precondition');
      unchangedFailure(root, uid, memo, 'failed-precondition');
    }
  }
});

test('다른 반의 마감은 담당 반 수정에 영향이 없으며 저장 직전 자기 반 마감은 차단', () => {
  const root = fixture();
  root.classdivide_workspaces[code].classStatus[2].completed = true;
  const request = detailsInput(root, { 생활지도: '중' });
  assert.equal(updateRemark(root, code, 'teacher', request, key).details.생활지도, '중');
  const stale = detailsInput(root, { 생활지도: '상' });
  root.classdivide_workspaces[code].classStatus[1].completed = true;
  unchangedFailure(root, 'teacher', stale, 'failed-precondition');
});

test('화면 편집 도중 엑셀 원본 항목이 바뀌면 버전이 같아도 구조화 저장 충돌', () => {
  const root = fixture();
  const request = detailsInput(root, { 생활지도: '상' });
  root.classdivide_workspaces[code].classInputs[1][0].학생선수 = true;
  unchangedFailure(root, 'creator', request, 'aborted');
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].version, 0);
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].details.학생선수, true);
});

test('동일 학생의 비고·구조화 항목 동시 수정은 충돌하며 다른 학생 저장은 독립', () => {
  const root = fixture();
  const structured = detailsInput(root, { 생활지도: '상' });
  const oldText = input(root, 1, 1000001, '이전 화면 비고');
  const other = detailsInput(root, { 통합학급: true }, 2, 2000001);
  const first = updateRemark(root, code, 'creator', structured, key);
  unchangedFailure(root, 'creator', oldText, 'aborted');
  const second = updateRemark(root, code, 'creator', other, key);
  assert.equal(second.details.통합학급, true);
  assert.deepEqual(listRemarks(root, code, 'teacher', key).notes['1:1000001'], first);
});

test('자유 비고만 수정해도 구조화 수정본을 유지하고 구조화 저장은 기존 비고 유지', () => {
  const root = fixture();
  updateRemark(root, code, 'creator', detailsInput(root, { 학습부진: false, 생활지도: '상' }), key);
  const afterText = updateRemark(root, code, 'creator', input(root, 1, 1000001, '자유 비고만 수정'), key);
  assert.equal(afterText.details.학습부진, false);
  assert.equal(afterText.details.생활지도, '상');
  assert.equal(afterText.text, '자유 비고만 수정');
  const afterDetails = updateRemark(root, code, 'creator', detailsInput(root, { 전출예정: true }), key);
  assert.equal(afterDetails.text, '자유 비고만 수정');
  assert.equal(afterDetails.details.전출예정, true);
  assert.equal(afterDetails.details.생활지도, '상');
  assert.equal(afterDetails.version, 3);
});

test('수정한 항목만 덮어쓰므로 미수정 항목의 후속 엑셀 값 변경은 반영', () => {
  const root = fixture();
  updateRemark(root, code, 'creator', detailsInput(root, { 학습부진: false }), key);
  const raw = root.classdivide_workspaces[code].classInputs[1][0];
  raw.학생선수 = true;
  raw.생활지도 = '중';
  raw.분리배정 = '새 엑셀 요청';
  let effective = listRemarks(root, code, 'teacher', key).notes['1:1000001'];
  assert.equal(effective.details.학습부진, false);
  assert.equal(effective.details.학생선수, true);
  assert.equal(effective.details.생활지도, '중');
  assert.equal(effective.details.분리배정, '새 엑셀 요청');
  // 원본과 같은 값으로 되돌린 항목은 덮어쓰기에서 빠져 후속 원본 갱신을 받습니다.
  updateRemark(root, code, 'creator', detailsInput(root, { 학습부진: true }), key);
  raw.학습부진 = false;
  effective = listRemarks(root, code, 'teacher', key).notes['1:1000001'];
  assert.equal(effective.details.학습부진, false);
});

test('구조화 암호문 형식표시 및 내용 변조는 재조회·재저장 모두 거부하고 자료 보존', () => {
  for (const tamper of ['format', 'ciphertext']) {
    const root = fixture();
    const request = detailsInput(root, { 생활지도: '상' });
    updateRemark(root, code, 'creator', request, key);
    const stored = root[REMARKS_PATH][code][1][request.identity];
    if (tamper === 'format') delete stored.format;
    else {
      const bytes = Buffer.from(stored.ciphertext, 'base64');
      bytes[0] ^= 1;
      stored.ciphertext = bytes.toString('base64');
    }
    const before = JSON.stringify(root);
    assert.throws(() => listRemarks(root, code, 'creator', key));
    assert.throws(() => updateRemark(root, code, 'creator', { ...request, expectedVersion: 1 }, key));
    assert.equal(JSON.stringify(root), before);
  }
});

test('JSON처럼 보이는 과거 자유 비고는 구조화 payload로 오인하지 않고 문자 그대로 유지', () => {
  const root = fixture();
  const literal = JSON.stringify({ schema: 'student-details-v1', text: '내용', details: { 학습부진: false } });
  const first = input(root, 1, 1000001, literal);
  updateRemark(root, code, 'creator', first, key);
  assert.equal(root[REMARKS_PATH][code][1][first.identity].format, undefined);
  assert.equal(listRemarks(root, code, 'teacher', key).notes['1:1000001'].text, literal);
  const converted = updateRemark(root, code, 'creator', detailsInput(root, { 생활지도: '상' }), key);
  assert.equal(converted.text, literal);
  assert.equal(converted.details.생활지도, '상');
  assert.equal(root[REMARKS_PATH][code][1][first.identity].format, 2);
});

test('명시적 쌍둥이 그룹 소속은 쌍둥이 여부·옵션 변경 차단하고 다른 항목은 허용', () => {
  for (const change of [{ 쌍둥이: false }, { 쌍둥이옵션: '동일' }]) {
    const root = fixture();
    const room = root.classdivide_workspaces[code];
    room.classInputs[1][0].쌍둥이 = true;
    room.classInputs[1][0].쌍둥이옵션 = '분리';
    room.twinGroups = { group: { id: 'group', option: '분리', studentIds: { 0: 1000001, 1: 2000001 } } };
    unchangedFailure(root, 'creator', detailsInput(root, change), 'failed-precondition');
    const beforeGroup = structuredClone(room.twinGroups);
    const saved = updateRemark(root, code, 'creator', detailsInput(root, { 생활지도: '중' }), key);
    assert.equal(saved.details.생활지도, '중');
    assert.equal(saved.details.쌍둥이, true);
    assert.deepEqual(room.twinGroups, beforeGroup);
    // 그룹을 정리한 뒤에는 다른 학생의 그룹을 건드리지 않고 수정할 수 있습니다.
    room.twinGroups = [{ id: 'other', option: '동일', studentIds: [1000002, 2000001] }];
    assert.equal(updateRemark(root, code, 'creator', detailsInput(root, change), key).error, undefined);
  }
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
  const otherClassChange = { roomCode: code, ...input(root, 2, 2000001) };
  await assert.rejects(callableExports.updateStudentRemark({ auth: { uid: 'teacher' }, data: otherClassChange }), error => error.code === 'permission-denied');
  assert.equal(JSON.stringify(root), before);
  const reread = await callableExports.listStudentRemarks({ auth: { uid: 'teacher' }, data: { roomCode: code } });
  assert.equal(reread.notes['1:1000001'].text, change.text);
  const structuredChange = { roomCode: code, ...detailsInput(root, { 생활지도: '상', 통합학급: true }) };
  const structuredResponse = await callableExports.updateStudentRemark({ auth: { uid: 'creator' }, data: structuredChange });
  assert.equal(structuredResponse.details.생활지도, '상');
  assert.equal(structuredResponse.details.통합학급, true);
  assert.equal(structuredResponse.text, change.text);
  const structuredReread = await callableExports.listStudentRemarks({ auth: { uid: 'teacher' }, data: { roomCode: code } });
  assert.deepEqual(structuredReread.notes['1:1000001'], structuredResponse);
  const structuredBeforeConflict = JSON.stringify(root);
  await assert.rejects(callableExports.updateStudentRemark({ auth: { uid: 'creator' }, data: structuredChange }),
    error => error.code === 'aborted');
  assert.equal(JSON.stringify(root), structuredBeforeConflict);
  const teacherChange = { roomCode: code, ...detailsInput(root, { 생활지도: '하' }) };
  const teacherResponse = await callableExports.updateStudentRemark({ auth: { uid: 'teacher' }, data: teacherChange });
  assert.equal(teacherResponse.details.생활지도, '하');
  assert.equal(teacherResponse.text, change.text);
  const adminReread = await callableExports.listStudentRemarks({ auth: { uid: 'recovered' }, data: { roomCode: code } });
  assert.deepEqual(adminReread.notes['1:1000001'], teacherResponse);
  const pendingBeforeRevoke = { roomCode: code, ...input(root) };
  root.roomMembers[code].teacher.active = false;
  const revokedSnapshot = JSON.stringify(root);
  await assert.rejects(callableExports.updateStudentRemark({ auth: { uid: 'teacher' }, data: pendingBeforeRevoke }),
    error => error.code === 'permission-denied');
  assert.equal(JSON.stringify(root), revokedSnapshot);
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
