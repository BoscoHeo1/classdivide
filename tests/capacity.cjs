// 운영 자료를 사용하지 않는 독립 회귀 검사. 원본 파일은 읽기만 합니다.
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
const run = loadTypeScript(path.join(repo, 'utils/algorithm.ts')).runPlacementAlgorithm;
const getCapacityViolation = loadTypeScript(path.join(repo, 'utils/capacityPlacement.ts')).getCapacityViolation;
const base = { currentClassCount: 11, nextClassCount: 11, normalCapacity: 24, reductionCount: 2, placementOrder: 'zigzag' };
function students(n, integrated = 6) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, 학년: 5, 현학급: Math.floor(i / 24) + 1, 번호: i % 24 + 1,
    이름: `가상${String(i + 1).padStart(4, '0')}`, 성별: i % 2 ? '남성' : '여성', 생년월일: `2014${String(i % 12 + 1).padStart(2, '0')}01`,
    학습부진: false, 생활지도: '', 학생선수: false, 통합학급: i < integrated,
    학부모민원: false, 쌍둥이: false, 전출예정: false, 분리배정: ''
  }));
}
function checkResult(input, settings, result) {
  assert.ok(result.capacityPlan, '정원 계획 메타데이터가 있어야 합니다');
  const plan = result.capacityPlan;
  assert.equal(plan.requestedNormalCapacity, settings.normalCapacity);
  assert.equal(typeof plan.effectiveNormalCapacity, 'number');
  assert.equal(typeof plan.message, 'string');
  const all = Object.values(result.assignments).flat();
  assert.equal(all.length, input.length, '모든 학생 배정');
  assert.equal(new Set(all.map(s => s.id)).size, input.length, '중복 배정 없음');
  assert.equal(Object.keys(plan.targets).length, settings.nextClassCount);
  assert.equal(Object.values(plan.targets).reduce((a, b) => a + b, 0), input.length, '목표 합계 일치');
  for (const [name, group] of Object.entries(result.assignments)) {
    assert.equal(group.length, plan.targets[name], `${name}반 목표 정원 일치`);
    assert.ok(Number.isInteger(plan.targets[name]) && plan.targets[name] >= 0);
    assert.ok(group.every(s => s.배정학급 === name));
  }
  for (const group of settings.twinGroups || []) {
    const found = all.filter(s => group.studentIds.includes(s.id));
    if (group.option === '동일') assert.equal(new Set(found.map(s => s.배정학급)).size, 1, '쌍둥이 동일반');
    else assert.equal(new Set(found.map(s => s.배정학급)).size, found.length, '쌍둥이 분리반');
  }
  return result;
}
function execute(input, settings = base) {
  const before = JSON.stringify(input);
  const result = run(input, settings);
  assert.equal(JSON.stringify(input), before, '입력 학생 배열을 변경하지 않음');
  return checkResult(input, settings, result);
}
function standardCounts(result) {
  const groups = Object.values(result.assignments);
  const integrated = groups.filter(a => a.some(s => s.통합학급));
  const general = groups.filter(a => !a.some(s => s.통합학급));
  assert.equal(integrated.length, 6);
  assert.deepEqual(integrated.map(a => a.length).sort((a,b)=>a-b), [23,23,23,23,23,23]);
  assert.deepEqual(general.map(a => a.length).sort((a,b)=>a-b), [25,25,25,25,26]);
}
const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
test('264명/11반/통합6/감축2: 기준24와30에서 학생수 기반 목표가 동일', () => {
  for (const normalCapacity of [24, 30]) {
    const result = execute(students(264), { ...base, normalCapacity });
    standardCounts(result);
    assert.equal(result.capacityPlan.effectiveNormalCapacity, 25);
    assert.ok(result.capacityPlan.message.trim(), '기준 정원과 실제 정원이 다르면 이유 표시');
  }
});
test('우선 배정 대상만 있어도 목표 인원을 지킴', () => {
  const input = students(264).map((s, i) => ({ ...s, 생활지도: '상', 학생선수: i % 3 === 0, 학습부진: i % 4 === 0, 학부모민원: i % 5 === 0 }));
  standardCounts(execute(input));
});
test('전출 예정 학생이 있어도 최종 총원과 목표 일치', () => {
  const input = students(264).map((s, i) => ({ ...s, 전출예정: i > 250 }));
  execute(input);
});
test('쌍둥이 동일/분리와 명시적 분리 요청 보존', () => {
  const input = students(264);
  input[20].분리배정 = input[22].이름;
  const settings = { ...base, twinGroups: [
    { id: 'same', studentIds: [11,12], option: '동일' },
    { id: 'separate', studentIds: [13,14], option: '분리' }
  ] };
  const result = execute(input, settings);
  const all = Object.values(result.assignments).flat();
  assert.notEqual(all.find(s=>s.id===21).배정학급, all.find(s=>s.id===23).배정학급, '분리 요청 준수');
});
test('통합 대상 2명이 동일반이어도 계획과 실제 배정 일치', () => {
  const input = students(80, 4);
  const settings = { ...base, currentClassCount: 4, nextClassCount: 4, twinGroups: [{ id:'integrated-pair', studentIds:[1,2], option:'동일' }] };
  const result = execute(input, settings);
  const groups = Object.values(result.assignments);
  const integrated = groups.filter(a=>a.some(s=>s.통합학급));
  const general = groups.filter(a=>!a.some(s=>s.통합학급));
  assert.equal(integrated.length, 3, '동일반 통합 대상은 하나의 통합학급으로 계산');
  for (const normal of general) for (const special of integrated) assert.ok(normal.length-special.length>=2, '학생 수와 무관하게 통합 학급당 감축2');
});
test('학생이 적어 감축이 수학적으로 불가능하면 명시 오류 또는 유효한 비음수 계획', () => {
  const input = students(3, 1);
  const settings = { ...base, currentClassCount: 1, nextClassCount: 5, reductionCount: 2 };
  let result;
  try { result = run(input, settings); }
  catch (error) { assert.ok(error instanceof Error && error.message.trim(), '명시적 실패 이유 필요'); return; }
  checkResult(input, settings, result);
  assert.ok(result.capacityPlan.message.trim(), '불가능한 감축에 대한 설명 필요');
});
test('감축0에서는 전체 반 크기 차이가 최대1', () => {
  const result = execute(students(264), { ...base, reductionCount: 0 });
  const counts = Object.values(result.assignments).map(a=>a.length);
  assert.equal(Math.max(...counts) - Math.min(...counts), 0);
});
test('통합 대상0명/학생수 나머지는 일반반에 균등 배정', () => {
  const result = execute(students(265, 0));
  const counts = Object.values(result.assignments).map(a=>a.length);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
});
test('모든 반이 통합학급이면 전체 학생수를 균등 배정', () => {
  const result = execute(students(264, 11));
  const counts = Object.values(result.assignments).map(a=>a.length);
  assert.ok(Object.values(result.assignments).every(a=>a.some(s=>s.통합학급)));
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
});
test('동일반과 분리반을 동시에 요청하면 조용히 무시하지 않고 실패', () => {
  const input = students(24, 0);
  input[0].분리배정 = input[1].이름;
  assert.throws(() => run(input, { ...base, currentClassCount: 1, nextClassCount: 2, twinGroups: [{ id:'contradiction', studentIds:[1,2], option:'동일' }] }), /충돌|만족|불가/);
});
test('0명 입력도 중복이나 잘못된 음수 정원 없이 처리', () => {
  const settings = { ...base, nextClassCount: 3 };
  const result = execute([], settings);
  assert.deepEqual(Object.values(result.capacityPlan.targets), [0,0,0]);
});
test('seed1~30 무작위 조건/전출/쌍둥이에서도 목표와 분리조건 보존', () => {
  const start = performance.now();
  let maxMs = 0;
  for (let seed = 1; seed <= 30; seed++) {
    let state = seed;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    const input = students(264).map(s => ({ ...s,
      생활지도: ['상','중','하',''][Math.floor(random()*4)],
      학생선수: random()<0.1, 학습부진: random()<0.2,
      학부모민원: random()<0.1, 전출예정: random()<0.05
    }));
    input[30].분리배정 = input[31].이름;
    const settings = { ...base, twinGroups: [
      { id:`same-${seed}`, studentIds:[11,12], option:'동일' },
      { id:`separate-${seed}`, studentIds:[13,14], option:'분리' }
    ] };
    const singleStart = performance.now();
    const result = execute(input, settings);
    maxMs = Math.max(maxMs, performance.now()-singleStart);
    standardCounts(result);
    const all = Object.values(result.assignments).flat();
    assert.notEqual(all.find(s=>s.id===31).배정학급, all.find(s=>s.id===32).배정학급, `seed${seed} 분리요청`);
  }
  console.log(`  무작위 30건 총 ${(performance.now()-start).toFixed(0)}ms / 최대 ${maxMs.toFixed(0)}ms`);
});
test('수동 정원 검증: 한명 이동/통합구분 변경 차단, 일반학생 맞교환 허용', () => {
  const result = execute(students(264));
  const names = result.activeClassNames;
  const first = names[0], second = names[1];
  const singleMove = structuredClone(result.assignments);
  singleMove[second].push(singleMove[first].pop());
  assert.ok(getCapacityViolation(result, singleMove), '단독 이동 차단');
  const intName = names.find(n=>result.assignments[n].some(s=>s.통합학급));
  const normalName = names.find(n=>!result.assignments[n].some(s=>s.통합학급));
  const changedType = structuredClone(result.assignments);
  const idx = changedType[intName].findIndex(s=>s.통합학급);
  [changedType[intName][idx],changedType[normalName][0]]=[changedType[normalName][0],changedType[intName][idx]];
  assert.ok(getCapacityViolation(result, changedType), '통합구분 변경 차단');
  const ordinarySwap = structuredClone(result.assignments);
  const a=ordinarySwap[first].findIndex(s=>!s.통합학급),b=ordinarySwap[second].findIndex(s=>!s.통합학급);
  [ordinarySwap[first][a],ordinarySwap[second][b]]=[ordinarySwap[second][b],ordinarySwap[first][a]];
  assert.equal(getCapacityViolation(result, ordinarySwap), null, '인원과 통합구분 유지한 교환 허용');
});
let failures = 0;
for (const { name, fn } of cases) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.log(`FAIL ${name}\n  ${error.stack}`); }
}
console.log(`${cases.length - failures}/${cases.length} passed`);
process.exitCode = failures ? 1 : 0;
