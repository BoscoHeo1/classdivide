// 가상 학생으로 특이사항 편집의 허용 필드와 기존 자료 보존을 확인합니다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = process.env.CLASSDIVIDE_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const loaded = new Map();
function loadTypeScript(filename) {
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleObject = { exports: {} };
  loaded.set(filename, moduleObject);
  const localRequire = specifier => specifier.startsWith('.')
    ? loadTypeScript(path.resolve(path.dirname(filename), `${specifier}.ts`))
    : require(require.resolve(specifier, { paths: [path.dirname(filename)] }));
  new Function('exports', 'require', 'module', compiled)(moduleObject.exports, localRequire, moduleObject);
  return moduleObject.exports;
}
const { studentDetailsFields, getStudentDetails, detailsEqual, replaceStudentDetails, replaceResultStudentDetails, studentDetailsSummary, MAX_SEPARATION_LENGTH } = loadTypeScript(path.join(repo, 'utils/studentDetails.ts'));
const student = (id, classNum = 1) => ({ id, 현학급: classNum, 학년: 5, 번호: id, 이름: `가상학생${classNum}_${id}`, 성별: '여성', 생년월일: '', 학습부진: false, 생활지도: '', 학생선수: false, 통합학급: false, 학부모민원: false, 쌍둥이: false, 전출예정: false, 비고: '별도 메모 유지', 배정학급: '가', 출석번호: id });
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('기존 자료에서 생략된 값은 아홉 허용 필드의 일관된 기본값으로 정규화', () => {
  assert.deepEqual(getStudentDetails({}), { 학습부진: false, 생활지도: '', 학생선수: false, 통합학급: false, 학부모민원: false, 쌍둥이: false, 쌍둥이옵션: '분리', 전출예정: false, 분리배정: '' });
  assert.deepEqual(Object.keys(getStudentDetails({})), [...studentDetailsFields]);
  assert.equal(detailsEqual({}, getStudentDetails({})), true);
});
test('모든 기존 특이사항 값과 여러 줄 분리배정은 편집 기본값에 유지', () => {
  const existing = { ...student(1), 학습부진: true, 생활지도: '상', 학생선수: true, 통합학급: true, 학부모민원: true, 쌍둥이: true, 쌍둥이옵션: '동일', 전출예정: true, 분리배정: '가상 학생B\n가상 학생C' };
  const details = getStudentDetails(existing);
  for (const field of studentDetailsFields) assert.equal(details[field], existing[field]);
  assert.equal(detailsEqual(existing, details), true);
  assert.equal(detailsEqual(existing, { ...details, 생활지도: '중' }), false);
});
test('정규화는 불리언·선택값을 제한하고 쌍둥이가 아니면 옵션 기본값 적용', () => {
  const details = getStudentDetails({ 학습부진: 'O', 생활지도: '잘못된 값', 학생선수: 1, 쌍둥이: false, 쌍둥이옵션: '동일', 분리배정: 123 });
  assert.equal(details.학습부진, false);
  assert.equal(details.생활지도, '');
  assert.equal(details.학생선수, false);
  assert.equal(details.쌍둥이옵션, '분리');
  assert.equal(details.분리배정, '123');
});
test('특이사항 변경은 선택한 학생만 수정하고 신원·자유 메모·배정·원본은 보존', () => {
  const input = [student(1), student(2), student(1, 2)];
  const before = structuredClone(input);
  const details = { ...getStudentDetails(input[0]), 학습부진: true, 생활지도: '중', 통합학급: true, 분리배정: '두 줄\n입력' };
  const actual = replaceStudentDetails(input, input[0], { ...details, 이름: '바꾸면 안 됨', 비고: '바꾸면 안 됨', 배정학급: '나', id: 999 });
  assert.equal(actual[0].학습부진, true);
  assert.equal(actual[0].생활지도, '중');
  assert.equal(actual[0].통합학급, true);
  assert.equal(actual[0].분리배정, '두 줄\n입력');
  for (const field of Object.keys(input[0]).filter(field => !studentDetailsFields.includes(field))) assert.deepEqual(actual[0][field], input[0][field]);
  assert.equal(actual[1], input[1]);
  assert.equal(actual[2], input[2]);
  assert.deepEqual(input, before);
});
test('ID 재사용과 메타정보가 같은 다른 행에는 특이사항 변경을 적용하지 않음', () => {
  const target = student(1);
  const sameIdOtherStudent = { ...target, 이름: '가상 신규학생' };
  const sameMetadataOtherId = { ...target, id: 2 };
  const input = [sameIdOtherStudent, sameMetadataOtherId];
  const actual = replaceStudentDetails(input, target, { ...getStudentDetails(target), 학생선수: true });
  assert.equal(actual[0], input[0]);
  assert.equal(actual[1], input[1]);
});
test('선택값 초기화·체크 해제·빈 분리배정 저장을 지원', () => {
  const target = { ...student(1), 생활지도: '상', 학습부진: true, 쌍둥이: true, 쌍둥이옵션: '동일', 분리배정: '없앨 내용' };
  const actual = replaceStudentDetails([target], target, getStudentDetails({}));
  assert.equal(actual[0].생활지도, '');
  assert.equal(actual[0].학습부진, false);
  assert.equal(actual[0].쌍둥이, false);
  assert.equal(actual[0].쌍둥이옵션, '분리');
  assert.equal(actual[0].분리배정, '');
  assert.equal(target.학습부진, true);
});
test('분리배정 1000자 경계는 보존하고 초과 입력은 기존 자료를 바꾸지 않고 거부', () => {
  const target = student(1);
  const before = structuredClone(target);
  assert.equal(MAX_SEPARATION_LENGTH, 1000);
  assert.equal(replaceStudentDetails([target], target, { ...getStudentDetails(target), 분리배정: '가'.repeat(1000) })[0].분리배정.length, 1000);
  assert.throws(() => replaceStudentDetails([target], target, { ...getStudentDetails(target), 분리배정: '가'.repeat(1001) }), /1000/);
  assert.deepEqual(target, before);
});
test('결과 자료 교체 유틸은 학생 필드만 바꾸고 기존 배정·통계·정원계획을 보존', () => {
  const input = [student(1), student(2)];
  const result = { assignments: { 가: [input[0]], 나: [input[1]] }, stats: { totalStudents: 2 }, activeClassNames: ['가', '나'], capacityPlan: { targets: { 가: 1, 나: 1 } } };
  const before = structuredClone(result);
  const actual = replaceResultStudentDetails(result, input[0], { ...getStudentDetails(input[0]), 학생선수: true });
  assert.equal(actual.assignments.가[0].학생선수, true);
  assert.equal(actual.assignments.가[0].배정학급, input[0].배정학급);
  assert.equal(actual.assignments.나[0], input[1]);
  assert.equal(actual.stats, result.stats);
  assert.equal(actual.capacityPlan, result.capacityPlan);
  assert.deepEqual(result, before);
  assert.equal(replaceResultStudentDetails(null, input[0], getStudentDetails(input[0])), null);
});
test('특이사항 요약은 기존 표시에 맞추며 쌍둥이 옵션은 선택 시에만 표시', () => {
  assert.equal(studentDetailsSummary({}), '-');
  assert.equal(studentDetailsSummary({ 쌍둥이: true, 쌍둥이옵션: '동일', 통합학급: true, 생활지도: '하' }), '생활(하), 특수(통합), 쌍둥이(같은반)');
  assert.equal(studentDetailsSummary({ 쌍둥이: false, 쌍둥이옵션: '동일' }), '-');
});
let passed = 0;
for (const { name, fn } of cases) { fn(); passed++; console.log(`PASS ${name}`); }
console.log(`특이사항 유틸 검사 ${passed}/${cases.length} 통과`);
