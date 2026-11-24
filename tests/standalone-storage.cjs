// 실제 학생 자료 없이 IndexedDB 영구 저장·이전·다중 탭 충돌·삭제를 검사합니다.
// 시험 의존성은 저장소 밖에서 준비합니다:
// npm install --prefix <시험폴더> fake-indexeddb
// NODE_PATH=<시험폴더>/node_modules node tests/standalone-storage.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb');
const repo = path.resolve(__dirname, '..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(repo, 'utils/standaloneStorage.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const DATA_KEY = 'classdivide_standalone_encrypted_v1';
const KEY_KEY = 'classdivide_standalone_key_v1';
function session() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
function runtime(indexedDB, sessionStorage = session(), crypto = webcrypto) {
  const moduleObject = { exports: {} };
  new Function('exports', 'require', 'module', 'globalThis', compiled)(moduleObject.exports, require, moduleObject, { indexedDB, sessionStorage, crypto, atob });
  return moduleObject.exports;
}
function snapshot(note = '') {
  return { students: [{ id: 1, 이름: '가상학생A', 현학급: 1, 비고: note }], result: { assignments: { A: [{ id: 1, 이름: '가상학생A', 현학급: 1, 배정학급: 'A', 비고: note }] }, activeClassNames: ['A'], stats: { totalStudents: 1 } }, settings: { currentClassCount: 1, nextClassCount: 1, normalCapacity: 24, reductionCount: 2, placementOrder: 'zigzag' }, step: 3, fileName: '가상자료.xlsx' };
}
async function raw(factory, transform) {
  const db = await new Promise((resolve, reject) => { const q = factory.open('classdivide_standalone_v2', 1); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  try { return await new Promise((resolve, reject) => { const t = db.transaction('workspace', transform ? 'readwrite' : 'readonly'); const s = t.objectStore('workspace'); const q = s.get('standalone'); let result; q.onsuccess = () => { result = q.result; if (transform) s.put(transform(result), 'standalone'); }; t.oncomplete = () => resolve(result); t.onabort = () => reject(t.error); t.onerror = () => reject(t.error); }); }
  finally { db.close(); }
}
async function legacy(storage, value) {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  storage.setItem(KEY_KEY, Buffer.from(bytes).toString('base64'));
  storage.setItem(DATA_KEY, JSON.stringify({ version: 1, iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(encrypted).toString('base64') }));
}
async function withWriteFailure(callback) { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function() { throw new DOMException('가상 저장 공간 부족', 'QuotaExceededError'); }; try { await callback(); } finally { IDBObjectStore.prototype.put = put; } }
async function main() {
  let passed = 0;
  async function test(name, callback) { await callback(); passed++; console.log('PASS ' + name); }
  await test('새 브라우저는 빈 자료로 시작', async () => assert.equal(await runtime(new IDBFactory()).loadStandalone(), null));
  await test('탭 종료 후 새 세션·모듈에서 명단·결과·설정 복원, 키 추출 금지', async () => {
    const db = new IDBFactory(), api = runtime(db); const initial = snapshot('첫 줄\n둘째 줄 <태그>');
    await api.loadStandalone(); await api.saveStandalone(initial);
    assert.deepEqual(await runtime(db, session()).loadStandalone(), initial);
    const stored = await raw(db); assert.equal(stored.key.extractable, false);
    await assert.rejects(webcrypto.subtle.exportKey('raw', stored.key));
    assert.ok(!JSON.stringify(stored).includes('가상학생A')); assert.ok(!JSON.stringify(stored).includes('첫 줄'));
  });
  await test('저장 실패는 이전 암호문 보존, 이후 재시도 가능', async () => {
    const db = new IDBFactory(), api = runtime(db); await api.saveStandalone(snapshot('이전')); const before = await raw(db);
    await withWriteFailure(() => assert.rejects(api.saveStandalone(snapshot('실패')), /저장하지 못했습니다/));
    assert.equal((await raw(db)).revision, before.revision); assert.deepEqual(await runtime(db).loadStandalone(), snapshot('이전'));
    await api.saveStandalone(snapshot('재시도')); assert.deepEqual(await runtime(db).loadStandalone(), snapshot('재시도'));
  });
  await test('연속 저장은 호출 시점의 복사본을 순서대로 기록', async () => {
    const db = new IDBFactory(), api = runtime(db), next = snapshot('마지막');
    const a = api.saveStandalone(snapshot('처음')), b = api.saveStandalone(next); next.students[0].비고 = '호출 뒤 변경'; await Promise.all([a, b]);
    assert.deepEqual(await api.loadStandalone(), snapshot('마지막'));
  });
  await test('StrictMode 중첩 복원이 느려도 이후 저장 revision을 되돌리지 않음', async () => {
    const db = new IDBFactory(); await runtime(db).saveStandalone(snapshot('시작'));
    let calls = 0, release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const crypto = {
      getRandomValues: bytes => webcrypto.getRandomValues(bytes), randomUUID: () => webcrypto.randomUUID(),
      subtle: {
        generateKey: (...args) => webcrypto.subtle.generateKey(...args),
        encrypt: (...args) => webcrypto.subtle.encrypt(...args),
        decrypt: async (...args) => { if (++calls === 2) { entered(); await gate; } return webcrypto.subtle.decrypt(...args); },
      },
    };
    const api = runtime(db, session(), crypto), firstLoad = api.loadStandalone(), lateLoad = api.loadStandalone();
    await firstLoad;
    const saving = api.saveStandalone(snapshot('새 저장'));
    await started;
    // 늦은 복호화 중에 새 저장 요청을 겹치게 하여 이전 구현의 revision 역행을 재현합니다.
    await new Promise(resolve => setTimeout(resolve, 30)); release();
    await Promise.all([lateLoad, saving]);
    await api.saveStandalone(snapshot('다음 저장'));
    assert.deepEqual(await runtime(db).loadStandalone(), snapshot('다음 저장'));
  });
  await test('저장 중 복원 요청과 다음 저장이 호출 순서대로 이어짐', async () => {
    const db = new IDBFactory(), api = runtime(db); await api.loadStandalone();
    const a = api.saveStandalone(snapshot('첫 저장')), read = api.loadStandalone(), b = api.saveStandalone(snapshot('둘째 저장'));
    await a; assert.deepEqual(await read, snapshot('첫 저장')); await b;
    assert.deepEqual(await runtime(db).loadStandalone(), snapshot('둘째 저장'));
  });
  await test('이전 탭의 오래된 저장은 새 탭 자료를 덮어쓰지 않음', async () => {
    const db = new IDBFactory(), a = runtime(db), b = runtime(db); await a.saveStandalone(snapshot('시작')); await b.loadStandalone();
    await a.saveStandalone(snapshot('최신')); await assert.rejects(b.saveStandalone(snapshot('오래된 탭')), /다른 탭/);
    assert.deepEqual(await runtime(db).loadStandalone(), snapshot('최신'));
  });
  await test('빈 저장소의 두 탭 최초 저장 경쟁에서 하나만 성공', async () => {
    const db = new IDBFactory(), a = runtime(db), b = runtime(db); await Promise.all([a.loadStandalone(), b.loadStandalone()]);
    const results = await Promise.allSettled([a.saveStandalone(snapshot('A')), b.saveStandalone(snapshot('B'))]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1); assert.equal(results.filter(x => x.status === 'rejected').length, 1);
    assert.ok(['A', 'B'].includes((await runtime(db).loadStandalone()).students[0].비고));
  });
  await test('변조된 암호문 복원 실패 뒤 자동 덮어쓰기 금지', async () => {
    const db = new IDBFactory(); await runtime(db).saveStandalone(snapshot('보존'));
    await raw(db, r => { const bytes = new Uint8Array(r.ciphertext); bytes[0] ^= 1; r.ciphertext = bytes.buffer; return r; });
    const before = await raw(db), api = runtime(db); await assert.rejects(api.loadStandalone(), /복원하지 못했습니다/); await assert.rejects(api.saveStandalone(snapshot('새 자료')), /자동 저장/);
    assert.equal((await raw(db)).revision, before.revision);
  });
  await test('키 누락 자료를 새 키로 덮어쓰지 않음', async () => {
    const db = new IDBFactory(); await runtime(db).saveStandalone(snapshot('보존')); await raw(db, r => { delete r.key; return r; });
    const api = runtime(db); await assert.rejects(api.loadStandalone(), /복원하지 못했습니다/); await assert.rejects(api.saveStandalone(snapshot('새 자료')), /자동 저장/);
    assert.equal((await raw(db)).key, undefined);
  });
  await test('v1 탭 자료는 영구 저장 완료 후에만 이전·제거', async () => {
    const db = new IDBFactory(), old = session(); await legacy(old, snapshot('이전 자료')); const api = runtime(db, old);
    assert.deepEqual(await api.loadStandalone(), snapshot('이전 자료')); assert.equal(old.getItem(DATA_KEY), null); assert.equal(old.getItem(KEY_KEY), null);
    assert.deepEqual(await runtime(db).loadStandalone(), snapshot('이전 자료'));
  });
  await test('v1 이전 실패 때 기존 세션 키·암호문 보존', async () => {
    const db = new IDBFactory(), old = session(); await legacy(old, snapshot('이전 자료')); const data = old.getItem(DATA_KEY), key = old.getItem(KEY_KEY);
    await withWriteFailure(() => assert.rejects(runtime(db, old).loadStandalone(), /복원하지 못했습니다/));
    assert.equal(old.getItem(DATA_KEY), data); assert.equal(old.getItem(KEY_KEY), key); assert.equal(await raw(db), undefined);
    assert.deepEqual(await runtime(db, old).loadStandalone(), snapshot('이전 자료'));
  });
  await test('현재 영구 자료는 남아 있는 이전 탭 자료보다 우선', async () => {
    const db = new IDBFactory(), old = session(); await runtime(db).saveStandalone(snapshot('현재')); await legacy(old, snapshot('예전 탭'));
    assert.deepEqual(await runtime(db, old).loadStandalone(), snapshot('현재')); assert.notEqual(old.getItem(DATA_KEY), null);
  });
  await test('삭제 요청은 진행·대기 저장을 무효화하고 자료가 부활하지 않음', async () => {
    const db = new IDBFactory(), api = runtime(db); await api.saveStandalone(snapshot('시작'));
    const saving = api.saveStandalone(snapshot('삭제 전 요청')), deletion = api.clearStandalone();
    await Promise.allSettled([saving, deletion]); await deletion;
    assert.equal(await runtime(db).loadStandalone(), null);
    await api.saveStandalone(snapshot('삭제 후 새 작업')); assert.deepEqual(await runtime(db).loadStandalone(), snapshot('삭제 후 새 작업'));
  });
  await test('다른 탭의 삭제 후 오래된 탭이 저장 자료를 부활시키지 않음', async () => {
    const db = new IDBFactory(), a = runtime(db), b = runtime(db); await a.saveStandalone(snapshot('시작')); await b.loadStandalone(); await a.clearStandalone();
    await assert.rejects(b.saveStandalone(snapshot('오래된 탭')), /다른 탭/); assert.equal(await runtime(db).loadStandalone(), null);
  });
  await test('빈 저장소에서 열린 탭도 다른 탭의 삭제 세대 뒤에는 저장 불가', async () => {
    const db = new IDBFactory(), a = runtime(db), b = runtime(db); await Promise.all([a.loadStandalone(), b.loadStandalone()]); await a.clearStandalone();
    const tombstone = await raw(db); assert.equal(tombstone.cleared, true); assert.equal(tombstone.key, undefined); assert.equal(tombstone.ciphertext, undefined);
    await assert.rejects(b.saveStandalone(snapshot('삭제 전 빈 탭')), /다른 탭/); assert.equal(await runtime(db).loadStandalone(), null);
  });
  await test('잘못된 스냅샷은 기존 저장 자료 보존', async () => {
    const db = new IDBFactory(), api = runtime(db); await api.saveStandalone(snapshot('보존')); const before = await raw(db);
    await assert.rejects(api.saveStandalone({ students: [], step: 9 }), /변환하지 못했습니다/); assert.equal((await raw(db)).revision, before.revision);
  });
  console.log(`${passed}개 일반모드 저장 검사 통과`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
