// 실제 학생 자료 없이 탭 전용 암호화 저장과 실패 시 보존을 검사합니다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(repo, 'utils/standaloneStorage.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const DATA_KEY = 'classdivide_standalone_encrypted_v1';
const KEY_KEY = 'classdivide_standalone_key_v1';

function runtime(storage) {
  const moduleObject = { exports: {} };
  const globals = { sessionStorage: storage, crypto: webcrypto, btoa, atob };
  new Function('exports', 'require', 'module', 'globalThis', compiled)(
    moduleObject.exports, require, moduleObject, globals
  );
  return moduleObject.exports;
}

function fakeStorage() {
  const values = new Map();
  return {
    values,
    failWrite: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.failWrite) throw new Error('가상 저장 공간 부족');
      values.set(key, String(value));
    }
  };
}

function snapshot(note = '') {
  return {
    students: [{ id: 1, 이름: '가상학생A', 현학급: 1, 비고: note }],
    result: { assignments: { A: [{ id: 1, 이름: '가상학생A', 현학급: 1, 배정학급: 'A', 비고: note }] }, activeClassNames: ['A'], stats: { totalStudents: 1 } },
    settings: { currentClassCount: 1, nextClassCount: 1, normalCapacity: 24, reductionCount: 2, placementOrder: 'zigzag' },
    step: 3,
    fileName: '가상자료.xlsx'
  };
}

async function main() {
  let passed = 0;
  async function test(name, callback) {
    await callback();
    passed++;
    console.log(`PASS ${name}`);
  }

  await test('저장 자료가 없으면 빈 복원 결과', async () => {
    assert.equal(await runtime(fakeStorage()).loadStandalone(), null);
  });

  await test('여러 줄·빈 비고·한글 및 배정 결과를 암호화하고 새 인스턴스에서 복원', async () => {
    const storage = fakeStorage();
    const first = snapshot('첫 줄\n둘째 줄 <태그>');
    await runtime(storage).saveStandalone(first);
    assert.ok(!storage.getItem(DATA_KEY).includes('가상학생A'));
    assert.ok(!storage.getItem(DATA_KEY).includes('첫 줄'));
    assert.deepEqual(await runtime(storage).loadStandalone(), first);
    const empty = snapshot('');
    await runtime(storage).saveStandalone(empty);
    assert.deepEqual(await runtime(storage).loadStandalone(), empty);
  });

  await test('저장 공간 오류 시 이전 암호문과 비고 보존 및 재시도 성공', async () => {
    const storage = fakeStorage();
    const api = runtime(storage);
    const initial = snapshot('이전 비고');
    await api.saveStandalone(initial);
    const previous = storage.getItem(DATA_KEY);
    storage.failWrite = true;
    await assert.rejects(api.saveStandalone(snapshot('실패한 수정')), /저장하지 못했습니다/);
    assert.equal(storage.getItem(DATA_KEY), previous);
    assert.deepEqual(await api.loadStandalone(), initial);
    storage.failWrite = false;
    await api.saveStandalone(snapshot('재시도'));
    assert.deepEqual(await api.loadStandalone(), snapshot('재시도'));
  });

  await test('동시 호출은 순서대로 저장하고 호출 뒤 원본 변경을 반영하지 않음', async () => {
    const storage = fakeStorage();
    const api = runtime(storage);
    const initial = snapshot('첫 번째');
    const next = snapshot('마지막');
    const firstSave = api.saveStandalone(initial);
    const nextSave = api.saveStandalone(next);
    next.students[0].비고 = '호출 뒤 변경';
    await Promise.all([firstSave, nextSave]);
    assert.deepEqual(await api.loadStandalone(), snapshot('마지막'));
  });

  await test('변조된 암호문은 복원 실패하며 임의 삭제하지 않음', async () => {
    const storage = fakeStorage();
    const api = runtime(storage);
    await api.saveStandalone(snapshot('보존'));
    const envelope = JSON.parse(storage.getItem(DATA_KEY));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString('base64');
    const modified = JSON.stringify(envelope);
    storage.values.set(DATA_KEY, modified);
    await assert.rejects(api.loadStandalone(), /복원하지 못했습니다/);
    assert.equal(storage.getItem(DATA_KEY), modified);
  });

  await test('키가 사라져도 기존 자료를 새 키로 덮어쓰지 않음', async () => {
    const storage = fakeStorage();
    const api = runtime(storage);
    await api.saveStandalone(snapshot('보존'));
    const previous = storage.getItem(DATA_KEY);
    storage.values.delete(KEY_KEY);
    await assert.rejects(api.loadStandalone(), /복원하지 못했습니다/);
    await assert.rejects(api.saveStandalone(snapshot('새 자료')), /저장하지 못했습니다/);
    assert.equal(storage.getItem(DATA_KEY), previous);
    assert.equal(storage.getItem(KEY_KEY), null);
  });

  await test('잘못된 스냅샷 형식은 기존 저장을 보존', async () => {
    const storage = fakeStorage();
    const api = runtime(storage);
    await api.saveStandalone(snapshot('보존'));
    const previous = storage.getItem(DATA_KEY);
    await assert.rejects(api.saveStandalone({ students: [], step: 9 }), /변환하지 못했습니다/);
    assert.equal(storage.getItem(DATA_KEY), previous);
  });

  console.log(`${passed}개 일반모드 저장 검사 통과`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
