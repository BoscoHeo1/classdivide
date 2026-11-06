// 가상 학생만 사용하는 담임별 자료 투영·비고 경계 검사입니다.
const assert = require('node:assert/strict');
const { teacherWorkspace } = require('../functions/teacherAccess');
const { listRemarks } = require('../functions/remarks');
const first = { id: 1000001, 현학급: 1, 이름: '가상학생A', 성별: '남성', 비고: '가상1반 비고' };
const second = { id: 2000001, 현학급: 2, 이름: '가상학생B', 성별: '여성', 비고: '가상2반 비고' };
const room = { code: 'FAKE_ACCESS', name: '가상학년', hostId: 'host-secret', recoveryInstanceId: 'private',
  currentClassCount: 2, nextClassCount: 2, reductionCount: 2, placementOrder: 'zigzag', step: 3, updatedAt: 1,
  classInputs: { 1: [first], 2: [second] }, classStatus: { 1: { completed: true }, 2: { teacherName: '다른담임', completed: true } },
  twinGroups: [{ studentIds: [first.id, second.id] }],
  result: { assignments: { 가: [first, second], 나: [second] }, stats: { totalStudents: 999 }, capacityPlan: { targets: { 가: 99 } } } };
const before = JSON.stringify(room);
for (const classNum of [1, 2]) {
  const member = { role: 'teacher', active: true, classNum };
  const view = teacherWorkspace(room, member).workspace;
  assert.ok(view.students.every(s => s.현학급 === classNum));
  assert.ok(Object.values(view.result.assignments).flat().every(s => s.현학급 === classNum));
  assert.equal(view.result.stats.totalStudents, Object.values(view.result.assignments).flat().length);
  assert.deepEqual(Object.keys(view.classStatus), [String(classNum)]);
  assert.equal(view.result.capacityPlan, undefined);
  assert.equal(view.hostId, undefined); assert.equal(view.recoveryInstanceId, undefined);
  assert.deepEqual(view.twinGroups, []);
  assert.ok(!JSON.stringify(view).includes(classNum === 1 ? '가상학생B' : '가상학생A'));
  const root = { classdivide_workspaces: { FAKE_ACCESS: room }, roomMembers: { FAKE_ACCESS: { teacher: member, admin: { role: 'admin', active: true, classNum: 0 } } } };
  assert.deepEqual(Object.keys(listRemarks(root, 'FAKE_ACCESS', 'teacher', () => '').notes), [classNum === 1 ? '1:1000001' : '2:2000001']);
  assert.equal(Object.keys(listRemarks(root, 'FAKE_ACCESS', 'admin', () => '').notes).length, 2);
}
for (const member of [null, { active: false, role: 'teacher', classNum: 1 }, { active: true, role: 'teacher', classNum: '1' },
  { active: true, role: 'teacher', classNum: 0 }, { active: true, role: 'teacher', classNum: 3 }, { active: true, role: 'admin', classNum: 0 }]) {
  assert.equal(teacherWorkspace(room, member).error.code, 'permission-denied');
}
assert.equal(JSON.stringify(room), before);
console.log('PASS 담임 2명별 학생·비고·결과·재계산 통계·상태 격리, 관리자 전체 비고, 잘못된 권한 차단, 원본 불변');
