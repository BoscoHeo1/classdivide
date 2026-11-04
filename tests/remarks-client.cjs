// 운영 자료·네트워크 없이 가상 학생과 메모리 속 엑셀만 사용하는 회귀 검사입니다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const repo = process.env.CLASSDIVIDE_ROOT || path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const XLSX = require(path.join(repo, 'node_modules/xlsx'));
globalThis.crypto ||= webcrypto;
const loaded = new Map();
const downloads = [];
const workbookApi = { ...XLSX, writeFile(workbook, filename) { downloads.push({ filename, bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) }); } };
function loadTypeScript(filename) {
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleObject = { exports: {} };
  loaded.set(filename, moduleObject);
  const localRequire = specifier => specifier === 'xlsx' ? workbookApi : specifier.startsWith('.')
    ? loadTypeScript(path.resolve(path.dirname(filename), `${specifier}.ts`))
    : require(require.resolve(specifier, { paths: [path.dirname(filename)] }));
  new Function('exports', 'require', 'module', compiled)(moduleObject.exports, localRequire, moduleObject);
  return moduleObject.exports;
}
const remarks = loadTypeScript(path.join(repo, 'utils/remarks.ts'));
const studentDetails = loadTypeScript(path.join(repo, 'utils/studentDetails.ts'));
const excel = loadTypeScript(path.join(repo, 'utils/excel.ts'));
const runPlacementAlgorithm = loadTypeScript(path.join(repo, 'utils/algorithm.ts')).runPlacementAlgorithm;
const serverIdentity = require(path.join(repo, 'functions/remarks.js')).studentIdentity;
globalThis.FileReader = class {
  readAsArrayBuffer(file) {
    const bytes = file.bytes;
    queueMicrotask(() => this.onload({ target: { result: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }));
  }
};
const student = (id, classNum = 1, text) => ({
  id, 학년: 5, 현학급: classNum, 번호: id, 이름: `가상학생${classNum}_${id}`, 성별: '여성', 생년월일: '',
  학습부진: false, 생활지도: '', 학생선수: false, 통합학급: false, 학부모민원: false,
  쌍둥이: false, 전출예정: false, 배정학급: '가', 출석번호: id, ...(text === undefined ? {} : { 비고: text })
});
const resultFor = students => ({ assignments: { 가: students.slice(0, 1), 나: students.slice(1) }, stats: { totalStudents: students.length }, activeClassNames: ['가', '나'], capacityPlan: { targets: { 가: 1, 나: students.length - 1 } } });
const recordFor = (s, text, version = 1, details) => ({ text, version,
  identity: createHash('sha256').update(remarks.studentSignature(s)).digest('hex'), ...(details ? { details } : {}) });
function workbookFile(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '가상명단');
  return { bytes: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
}
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('단일 비고 교체는 해당 학생만 바꾸고 원본 배열·다른 학생·배정과 특이사항을 보존', () => {
  const input = [student(1), student(2, 1, '유지'), student(1, 2, '다른 반')];
  input[0].통합학급 = true;
  const before = structuredClone(input);
  const actual = remarks.replaceRemark(input, input[0], '첫 줄\n둘째 줄');
  assert.equal(actual[0].비고, '첫 줄\n둘째 줄');
  assert.deepEqual({ ...actual[0], 비고: undefined }, { ...input[0], 비고: undefined });
  assert.equal(actual[1], input[1]);
  assert.equal(actual[2], input[2]);
  assert.deepEqual(input, before);
});
test('빈 비고 추가·지우기·미존재 대상은 다른 자료를 훼손하지 않음', () => {
  const input = [student(1), student(2, 1, '삭제할 메모')];
  assert.equal(remarks.replaceRemark(input, input[0], '새 내용')[0].비고, '새 내용');
  assert.equal(remarks.replaceRemark(input, input[1], '')[1].비고, '');
  assert.deepEqual(remarks.replaceRemark(input, student(999), '무관'), input);
});
test('배정 결과 비고 교체는 반별 인원·배정·통계·정원계획과 원본 결과를 보존', () => {
  const students = [student(1), student(2, 1, '유지')];
  const input = resultFor(students);
  const before = structuredClone(input);
  const actual = remarks.replaceResultRemark(input, students[0], '수정');
  assert.equal(actual.assignments.가[0].비고, '수정');
  assert.equal(actual.assignments.나[0], students[1]);
  assert.equal(actual.stats, input.stats);
  assert.equal(actual.capacityPlan, input.capacityPlan);
  assert.deepEqual(input, before);
  assert.equal(remarks.replaceResultRemark(null, students[0], '수정'), null);
});
test('서버·브라우저 학생 지문 정규화 및 SHA-256이 동일', async () => {
  for (const s of [student(1000001), { ...student(1000002), 번호: '', 학년: '', 생년월일: '' }]) {
    const record = recordFor(s, '검사');
    assert.equal(record.identity, serverIdentity(s));
    const matched = await remarks.matchRemarkRecords([s], { [remarks.remarkKey(s)]: record });
    assert.equal(matched[remarks.remarkKey(s)].signature, remarks.studentSignature(s));
  }
});
test('비고 조회 응답은 현재 학생에 맞는 지문만 합치고 원본과 버전을 보존', async () => {
  const input = [student(1000001), student(1000002, 1, '원본')];
  const notes = { [remarks.remarkKey(input[0])]: recordFor(input[0], '저장된\n비고', 3) };
  const before = structuredClone(notes);
  const matched = await remarks.matchRemarkRecords(input, notes);
  const actual = remarks.applyRemarks(input, matched);
  assert.equal(actual[0].비고, '저장된\n비고');
  assert.equal(matched[remarks.remarkKey(input[0])].version, 3);
  assert.equal(actual[1], input[1]);
  assert.deepEqual(notes, before);
  assert.equal(input[0].비고, undefined);
});
test('학급 행 ID 재사용·늦은 이전 명단 응답·다른 반 비고를 새 학생에게 붙이지 않음', async () => {
  const oldStudent = student(1000001);
  const newStudent = { ...oldStudent, 이름: '가상신규학생', 번호: 77 };
  const notes = { [remarks.remarkKey(oldStudent)]: recordFor(oldStudent, '이전 학생 메모') };
  assert.deepEqual(await remarks.matchRemarkRecords([newStudent], notes), {});
  const oldMatched = await remarks.matchRemarkRecords([oldStudent], notes);
  assert.equal(remarks.applyRemarks([newStudent], oldMatched)[0].비고, undefined);
  assert.equal(remarks.applyRemarks([{ ...oldStudent, 현학급: 2 }], oldMatched)[0].비고, undefined);
});
test('삭제·재정렬로 행 ID가 달라져도 서버가 현재 ID로 돌려준 동일 학생 비고를 보존', async () => {
  const original = student(1000002, 1, '엑셀 원본');
  const saved = recordFor(original, '서버 저장 메모', 4);
  const reordered = { ...original, id: 1000001 };
  assert.equal(remarks.studentSignature(original), remarks.studentSignature(reordered));
  assert.equal(serverIdentity(original), serverIdentity(reordered));
  // 서버는 안정 지문의 저장본을 찾아 현재 화면 ID를 조회 응답 키로 사용합니다.
  const records = { [remarks.remarkKey(reordered)]: saved };
  const matched = await remarks.matchRemarkRecords([reordered], records);
  assert.equal(matched[remarks.remarkKey(reordered)].version, 4);
  assert.equal(remarks.applyRemarks([reordered], matched)[0].비고, '서버 저장 메모');
});
test('완전히 동일한 메타정보라도 행 ID가 다르면 비고 교체는 선택한 한 학생만 변경', () => {
  const selected = student(1000001, 1, '선택한 학생');
  const other = { ...selected, id: 1000002, 비고: '다른 행 유지' };
  const actual = remarks.replaceRemark([selected, other], selected, '새 내용');
  assert.equal(actual[0].비고, '새 내용');
  assert.equal(actual[1], other);
  assert.equal(actual[1].비고, '다른 행 유지');
  assert.equal(selected.비고, '선택한 학생');
});
test('결과 화면 비고 합치기는 편성결과를 수정하지 않으며 빈 문자열을 보존', async () => {
  const s = student(1000001, 1, '초기 비고');
  const input = resultFor([s]);
  const matched = await remarks.matchRemarkRecords([s], { [remarks.remarkKey(s)]: recordFor(s, '') });
  const actual = remarks.applyResultRemarks(input, matched);
  assert.equal(actual.assignments.가[0].비고, '');
  assert.equal(input.assignments.가[0].비고, '초기 비고');
  assert.equal(actual.stats, input.stats);
  assert.equal(remarks.applyResultRemarks(null, matched), null);
});
test('암호화 조회의 구조화 항목은 선택 학생·결과 화면에만 합치고 원본과 배정 유지', async () => {
  const raw = [student(1000001, 1, '원본 비고'), student(1000002, 1, '다른 학생 비고')];
  raw[0].학습부진 = true;
  const details = studentDetails.getStudentDetails({ ...raw[0], 학습부진: false,
    생활지도: '상', 학생선수: true, 통합학급: true, 학부모민원: true,
    쌍둥이: true, 쌍둥이옵션: '동일', 전출예정: true, 분리배정: '2반 가상학생'
  });
  const notes = { [remarks.remarkKey(raw[0])]: recordFor(raw[0], '수정 비고', 7, details) };
  const before = structuredClone({ raw, notes });
  const matched = await remarks.matchRemarkRecords(raw, notes);
  const effective = remarks.applyRemarks(raw, matched);
  assert.deepEqual(studentDetails.getStudentDetails(effective[0]), details);
  assert.equal(effective[0].비고, '수정 비고');
  assert.equal(effective[0].이름, raw[0].이름);
  assert.equal(effective[0].번호, raw[0].번호);
  assert.equal(effective[0].배정학급, raw[0].배정학급);
  assert.equal(effective[0].출석번호, raw[0].출석번호);
  assert.equal(effective[1], raw[1]);
  const result = resultFor(raw);
  const view = remarks.applyResultRemarks(result, matched);
  assert.deepEqual(studentDetails.getStudentDetails(view.assignments.가[0]), details);
  assert.equal(view.assignments.가[0].비고, '수정 비고');
  assert.equal(view.assignments.나[0], raw[1]);
  assert.equal(view.stats, result.stats);
  assert.equal(view.capacityPlan, result.capacityPlan);
  assert.deepEqual({ raw, notes }, before);
});

test('새 학생에게 늦은 이전 구조화 응답을 붙이지 않음', async () => {
  const original = student(1000001);
  const replacement = { ...original, 이름: '가상 신규 학생', 번호: 9 };
  const details = studentDetails.getStudentDetails({ ...original, 통합학급: true, 생활지도: '상' });
  const matched = await remarks.matchRemarkRecords([original], {
    [remarks.remarkKey(original)]: recordFor(original, '이전 메모', 2, details)
  });
  assert.equal(remarks.applyRemarks([replacement], matched)[0], replacement);
  assert.equal(remarks.applyResultRemarks(resultFor([replacement]), matched).assignments.가[0], replacement);
});

test('결과 저장은 암호화 수정 필드·비고를 엑셀 원본으로 되돌리고 원래 누락 키는 삭제', async () => {
  const raw = [student(1000001), student(1000002, 1, '원본 비고')];
  delete raw[0].학부모민원;
  delete raw[0].생활지도;
  delete raw[0].쌍둥이옵션;
  raw[1].학습부진 = true;
  raw[1].생활지도 = '중';
  const notes = Object.fromEntries(raw.map(s => [remarks.remarkKey(s), recordFor(s, '암호화한 메모', 1,
    studentDetails.getStudentDetails({ ...s, 학습부진: false, 생활지도: '상', 학생선수: true,
      통합학급: true, 학부모민원: true, 쌍둥이: true, 쌍둥이옵션: '동일', 전출예정: true,
      분리배정: '암호화한 분리 요청' }))]));
  const matched = await remarks.matchRemarkRecords(raw, notes);
  const displayed = remarks.applyResultRemarks(resultFor(raw), matched);
  displayed.assignments.가[0].배정학급 = '가';
  displayed.assignments.나[0].배정학급 = '나';
  displayed.assignments.나[0].출석번호 = 8;
  const before = structuredClone(displayed);
  const stored = remarks.resultForStorage(displayed, raw);
  const storedA = stored.assignments.가[0];
  const storedB = stored.assignments.나[0];
  for (const field of [...studentDetails.studentDetailsFields, '비고']) {
    if (Object.hasOwn(raw[0], field)) assert.equal(storedA[field], raw[0][field]);
    else assert.equal(Object.hasOwn(storedA, field), false, `${field} 누락 상태 보존`);
    if (Object.hasOwn(raw[1], field)) assert.equal(storedB[field], raw[1][field]);
    else assert.equal(Object.hasOwn(storedB, field), false, `${field} 누락 상태 보존`);
  }
  assert.equal(storedA.배정학급, '가');
  assert.equal(storedB.배정학급, '나');
  assert.equal(storedB.출석번호, 8);
  assert.equal(stored.stats, displayed.stats);
  assert.equal(stored.capacityPlan, displayed.capacityPlan);
  assert.equal(stored.activeClassNames, displayed.activeClassNames);
  assert.deepEqual(displayed, before);
  assert.ok(!JSON.stringify(stored).includes('암호화한 메모'));
  assert.ok(!JSON.stringify(stored).includes('암호화한 분리 요청'));
  assert.deepEqual(remarks.applyResultRemarks(stored, matched), displayed, '저장 후 재조회 화면에서 암호화 수정값을 재결합');
});

test('결과 저장 대상의 학생 신원이 바뀌면 원본 추측 없이 저장 거부', () => {
  const raw = [student(1000001)];
  const changed = { ...raw[0], 이름: '바뀐 학생' };
  const result = resultFor([changed]);
  const before = structuredClone(result);
  assert.throws(() => remarks.resultForStorage(result, raw), /학생 명단이 변경/);
  assert.deepEqual(result, before);
});

test('편성 알고리즘은 화면에서 수정한 통합·생활·지원·분리·쌍둥이 항목으로 계산', async () => {
  const raw = Array.from({ length: 8 }, (_, index) => student(index + 1, 1));
  const changed = studentDetails.getStudentDetails({ ...raw[0], 통합학급: true, 생활지도: '상',
    학습부진: true, 학생선수: true, 학부모민원: true, 전출예정: true,
    분리배정: `1반 ${raw[1].이름}` });
  const notes = { [remarks.remarkKey(raw[0])]: recordFor(raw[0], '수정 후 배정', 1, changed) };
  for (const twin of [raw[2], raw[3]]) {
    notes[remarks.remarkKey(twin)] = recordFor(twin, '', 1,
      studentDetails.getStudentDetails({ ...twin, 쌍둥이: true, 쌍둥이옵션: '동일' }));
  }
  const matched = await remarks.matchRemarkRecords(raw, notes);
  const effective = remarks.applyRemarks(raw, matched);
  const before = structuredClone(effective);
  const result = runPlacementAlgorithm(effective, {
    currentClassCount: 1, nextClassCount: 2, normalCapacity: 4, reductionCount: 2, placementOrder: 'zigzag'
  });
  const all = Object.values(result.assignments).flat();
  const byId = new Map(all.map(s => [s.id, s]));
  assert.equal(result.stats.integrated, 1);
  assert.equal(result.stats.highGuidance, 1);
  assert.equal(result.stats.underachieving, 1);
  assert.equal(result.stats.athletes, 1);
  assert.equal(result.stats.parentComplaints, 1);
  assert.equal(result.assignments[byId.get(1).배정학급].length, 3, '수정된 통합학급에 감축 적용');
  assert.notEqual(byId.get(1).배정학급, byId.get(2).배정학급, '수정한 분리 요청 적용');
  assert.equal(byId.get(3).배정학급, byId.get(4).배정학급, '수정한 쌍둥이 같은반 적용');
  assert.equal(result.assignments[byId.get(1).배정학급].at(-1).id, 1, '수정한 전출예정은 뒤 번호');
  assert.equal(byId.get(1).비고, '수정 후 배정');
  assert.deepEqual(effective, before, '알고리즘이 편집된 입력을 변경하지 않음');
  assert.ok(raw.every(s => s.통합학급 === false && s.쌍둥이 === false), '엑셀 원본 불변');
  const stored = remarks.resultForStorage(result, raw);
  assert.ok(Object.values(stored.assignments).flat().every(s => s.통합학급 === false && s.쌍둥이 === false));
  assert.equal(stored.stats, result.stats);
  assert.deepEqual(remarks.applyResultRemarks(stored, matched), result);
});

test('협업의 빈 명시적 그룹은 생년월일로 쌍둥이 관계를 자동 추정하지 않으며 일반모드 추정은 유지', () => {
  const input = Array.from({ length: 8 }, (_, index) => student(index + 1));
  input[0] = { ...input[0], 쌍둥이: true, 쌍둥이옵션: '동일', 생년월일: '2014.01.01', 분리배정: `1반 ${input[1].이름}` };
  input[1] = { ...input[1], 쌍둥이: true, 쌍둥이옵션: '동일', 생년월일: '2014.01.01' };
  const settings = { currentClassCount: 1, nextClassCount: 2, normalCapacity: 4, reductionCount: 0, placementOrder: 'zigzag' };
  assert.throws(() => runPlacementAlgorithm(input, settings), /동일|분리|같은|충돌/);
  const result = runPlacementAlgorithm(input, { ...settings, twinGroups: [] });
  const placed = Object.values(result.assignments).flat();
  assert.notEqual(placed.find(s => s.id === 1).배정학급, placed.find(s => s.id === 2).배정학급);
});

test('실제 XLSX 바이트 읽기: 여러줄·빈값·숫자 비고와 기존 학생 속성 유지', async () => {
  const rows = [
    { 학년: 5, 반: 1, 번호: 1, 성명: '가상학생A', 성별: '여', 비고: '메모 첫 줄\n둘째 줄', 통합학급: 'O', 생활지도: '중' },
    { 학년: 5, 반: 1, 번호: 2, 성명: '가상학생B', 성별: '남', 비고: '' },
    { 학년: 5, 반: 2, 번호: 1, 성명: '가상학생C', 성별: '여', 비고: 123 }
  ];
  const actual = await excel.parseExcel(workbookFile(rows));
  assert.equal(actual.length, 3);
  assert.equal(actual[0].비고, rows[0].비고);
  assert.equal(actual[0].통합학급, true);
  assert.equal(actual[0].생활지도, '중');
  assert.equal(actual[0].성별, '여성');
  assert.equal(actual[1].비고, '');
  assert.equal(actual[2].비고, '123');
});
test('비고 열 없는 기존 엑셀도 그대로 읽기 가능', async () => {
  const actual = await excel.parseExcel(workbookFile([{ 반: 1, 번호: 1, 성명: '가상학생A', 성별: '남' }]));
  assert.equal(actual.length, 1);
  assert.equal(actual[0].비고, '');
  assert.equal(actual[0].이름, '가상학생A');
});
test('기존반·배정반 내보내기 모든 시트에서 비고와 특이사항·번호를 함께 보존', () => {
  const input = [student(1, 1, '첫 줄\n둘째 줄'), { ...student(2, 2, ''), 배정학급: '나', 통합학급: true }];
  excel.downloadResultsByNewClass(input, { 가: [input[0]], 나: [input[1]] });
  excel.downloadResultsByOldClass(input);
  assert.equal(downloads.length, 2);
  for (const download of downloads) {
    const workbook = XLSX.read(download.bytes, { type: 'buffer' });
    assert.equal(workbook.SheetNames.length, 3);
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '' });
      for (const row of rows) {
        assert.ok(Object.hasOwn(row, '비고'));
        assert.equal(row.비고, row.이름 === input[0].이름 ? input[0].비고 : '');
        assert.equal(row.특이사항, row.이름 === input[0].이름 ? '' : '통합학급');
        assert.ok(Object.hasOwn(row, '출석번호'));
      }
    }
  }
});

(async () => {
  let passed = 0;
  for (const { name, run } of cases) {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`비고 클라이언트 회귀 검사 ${passed}/${cases.length} 통과`);
})().catch(error => { console.error(error); process.exitCode = 1; });
