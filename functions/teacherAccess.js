'use strict';
const { studentsInRoom } = require('./remarks');

// 반환 필드를 고정하여 다른 반 통계·쌍둥이 그룹·복구 정보가 응답에 섞이지 않게 합니다.
function teacherWorkspace(room, member) {
  if (!room || member?.active !== true || member.role !== 'teacher'
    || !Number.isSafeInteger(member.classNum) || member.classNum < 1 || member.classNum > room.currentClassCount) {
    return { error: { code: 'permission-denied', message: '승인된 담당 학급 권한이 필요합니다.' } };
  }
  const classNum = member.classNum;
  const students = studentsInRoom(room).filter(student => student.현학급 === classNum);
  const status = room.classStatus?.[classNum];
  const workspace = Object.fromEntries(['code', 'name', 'currentClassCount', 'nextClassCount', 'reductionCount',
    'placementOrder', 'step', 'updatedAt'].filter(key => room[key] !== undefined).map(key => [key, room[key]]));
  workspace.students = students;
  workspace.classStatus = status ? { [classNum]: status } : {};
  workspace.twinGroups = [];
  if (room.result) {
    const assignments = Object.fromEntries(Object.entries(room.result.assignments || {}).map(([name, rows]) =>
      [name, Object.values(rows || {}).filter(student => student && student.현학급 === classNum)])
      .filter(([, rows]) => rows.length));
    const assigned = Object.values(assignments).flat();
    workspace.result = {
      assignments, activeClassNames: Object.keys(assignments),
      stats: {
        totalStudents: assigned.length,
        totalMale: assigned.filter(s => s.성별 === '남성').length,
        totalFemale: assigned.filter(s => s.성별 === '여성').length,
        duplicates: assigned.filter(s => s.동명이인 === true).length,
        highGuidance: assigned.filter(s => s.생활지도 === '상').length,
        integrated: assigned.filter(s => s.통합학급 === true).length,
        underachieving: assigned.filter(s => s.학습부진 === true).length,
        athletes: assigned.filter(s => s.학생선수 === true).length,
        parentComplaints: assigned.filter(s => s.학부모민원 === true).length
      }
    };
  }
  return { workspace };
}
module.exports = { teacherWorkspace };
