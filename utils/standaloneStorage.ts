import type { ClassSettings, PlacementResult, Student } from '../types';

export interface StandaloneSnapshot {
  students: Student[];
  result: PlacementResult | null;
  settings: ClassSettings;
  step: number;
  fileName: string;
}

const DATA_KEY = 'classdivide_standalone_encrypted_v1';
const KEY_KEY = 'classdivide_standalone_key_v1';
const DB_NAME = 'classdivide_standalone_v2';
const STORE = 'workspace';
const RECORD = 'standalone';
interface StoredWorkspace {
  version: 2;
  revision: string;
  key: CryptoKey;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}
interface ClearedWorkspace { version: 2; revision: string; cleared: true; }
type WorkspaceRecord = StoredWorkspace | ClearedWorkspace;
const isCleared = (record: WorkspaceRecord): record is ClearedWorkspace => 'cleared' in record && record.cleared === true;
let database: Promise<IDBDatabase> | undefined;
let pendingSave: Promise<void> = Promise.resolve();
let expectedRevision: string | null | undefined;
let generation = 0;
let blocked = false;

// 브라우저 저장은 같은 출처의 악성 스크립트까지 막는 비밀 보관함이 아닙니다.
// 키는 추출할 수 없는 CryptoKey로만 보관하고 평문 학생 자료는 저장하지 않습니다.
const openDatabase = (): Promise<IDBDatabase> => {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 탭이 저장소를 사용 중입니다.'));
  }).catch(error => { database = undefined; throw error; });
  return database;
};

const readRecord = async (): Promise<WorkspaceRecord | undefined> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(RECORD);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('저장 자료 조회가 중단되었습니다.'));
  });
};

const conflict = () => new Error('다른 탭에서 저장 자료가 변경되었습니다. 현재 입력을 백업한 뒤 새로고침해 주세요.');

// 읽기·revision 비교·쓰기를 한 트랜잭션에 묶어 여러 탭의 조용한 덮어쓰기를 막습니다.
const compareAndWrite = async (revision: string | null, next: WorkspaceRecord, fence: number): Promise<void> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(RECORD);
    let failure: Error | undefined;
    request.onsuccess = () => {
      const current = request.result as WorkspaceRecord | undefined;
      if (fence !== generation || (current?.revision ?? null) !== revision) {
        failure = conflict();
        transaction.abort();
        return;
      }
      try { store.put(next, RECORD); }
      catch (error) { failure = error instanceof Error ? error : new Error('저장 공간 오류'); transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure || transaction.error);
    transaction.onabort = () => reject(failure || transaction.error || new Error('저장 작업이 중단되었습니다.'));
  });
};

const validateSnapshot = (value: unknown): StandaloneSnapshot => {
  const snapshot = value as StandaloneSnapshot;
  if (!snapshot || !Array.isArray(snapshot.students) || !snapshot.settings
    || ![1, 2, 3].includes(snapshot.step) || typeof snapshot.fileName !== 'string'
    || !(snapshot.result === null || (snapshot.result && typeof snapshot.result.assignments === 'object'))) {
    throw new Error('저장된 일반모드 자료의 형식을 확인할 수 없습니다.');
  }
  return snapshot;
};

const decryptRecord = async (record: StoredWorkspace): Promise<StandaloneSnapshot> => {
  if (record.version !== 2 || typeof record.revision !== 'string' || !record.revision
    || !record.key || record.key.extractable || record.key.type !== 'secret'
    || record.key.algorithm.name !== 'AES-GCM' || !(record.iv instanceof Uint8Array)
    || record.iv.length !== 12 || !(record.ciphertext instanceof ArrayBuffer)) throw new Error('저장 형식 오류');
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, record.key, record.ciphertext);
  return validateSnapshot(JSON.parse(new TextDecoder().decode(plaintext)));
};

const encryptSnapshot = async (plaintext: Uint8Array): Promise<StoredWorkspace> => {
  const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { version: 2, revision: globalThis.crypto.randomUUID(), key, iv, ciphertext };
};

const legacySnapshot = async (): Promise<{ snapshot: StandaloneSnapshot; data: string; key: string } | null> => {
  const data = globalThis.sessionStorage.getItem(DATA_KEY);
  if (data === null) return null;
  const keyText = globalThis.sessionStorage.getItem(KEY_KEY);
  if (!keyText) throw new Error('기존 자료의 키가 없습니다.');
  const decode = (value: string) => Uint8Array.from(globalThis.atob(value), character => character.charCodeAt(0));
  const envelope = JSON.parse(data);
  const bytes = decode(keyText);
  if (envelope.version !== 1 || bytes.length !== 32 || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('기존 자료 형식 오류');
  const key = await globalThis.crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv) }, key, decode(envelope.ciphertext));
  return { snapshot: validateSnapshot(JSON.parse(new TextDecoder().decode(plaintext))), data, key: keyText };
};

const loadStandaloneNow = async (fence: number): Promise<StandaloneSnapshot | null> => {
  try {
    let stored = await readRecord();
    if (stored) {
      const snapshot = isCleared(stored) ? null : await decryptRecord(stored);
      if (fence !== generation) throw conflict();
      expectedRevision = stored.revision;
      blocked = false;
      return snapshot;
    }
    const legacy = await legacySnapshot();
    if (!legacy) { if (fence !== generation) throw conflict(); expectedRevision = null; blocked = false; return null; }
    const migrated = await encryptSnapshot(new TextEncoder().encode(JSON.stringify(legacy.snapshot)));
    try { await compareAndWrite(null, migrated, fence); }
    catch (error) {
      // 다른 탭이 먼저 저장했으면 현재 영구 자료를 우선하며 기존 탭 자료는 보존합니다.
      stored = await readRecord();
      if (!stored || fence !== generation) throw error;
      const snapshot = isCleared(stored) ? null : await decryptRecord(stored);
      expectedRevision = stored.revision; blocked = false;
      return snapshot;
    }
    expectedRevision = migrated.revision; blocked = false;
    // 영구 저장 트랜잭션 완료 뒤에만 이번에 옮긴 기존 자료를 제거합니다.
    try {
      if (globalThis.sessionStorage.getItem(DATA_KEY) === legacy.data && globalThis.sessionStorage.getItem(KEY_KEY) === legacy.key) {
        globalThis.sessionStorage.removeItem(DATA_KEY); globalThis.sessionStorage.removeItem(KEY_KEY);
      }
    } catch { /* 이전 자료 제거 실패는 새 영구 저장의 성공을 취소하지 않습니다. */ }
    return legacy.snapshot;
  } catch {
    blocked = true;
    throw new Error('일반모드 저장 자료를 복원하지 못했습니다. 기존 저장 자료는 보존되며 자동 저장을 중단했습니다.');
  }
};

export const loadStandalone = (): Promise<StandaloneSnapshot | null> => {
  const fence = generation;
  // StrictMode의 중복 복원도 저장·삭제와 같은 큐에서 실행합니다.
  // 늦게 끝난 복원이 새 저장의 revision을 예전 값으로 되돌리지 못하게 합니다.
  const operation = pendingSave.catch(() => undefined).then(() => loadStandaloneNow(fence));
  pendingSave = operation.then(() => undefined, () => undefined);
  return operation;
};

export const saveStandalone = (snapshot: StandaloneSnapshot): Promise<void> => {
  let plaintext: Uint8Array;
  try { plaintext = new TextEncoder().encode(JSON.stringify(validateSnapshot(snapshot))); }
  catch { return Promise.reject(new Error('일반모드 자료를 저장할 수 있는 형식으로 변환하지 못했습니다.')); }
  const fence = generation;
  const operation = pendingSave.catch(() => undefined).then(async () => {
    if (fence !== generation) throw new Error('저장 자료 삭제 이후의 이전 저장 요청을 중단했습니다.');
    if (blocked) throw new Error('저장 자료를 복원하지 못해 자동 저장을 중단했습니다.');
    // UI는 먼저 loadStandalone을 호출하지만 직접 호출해도 기존 암호문을 덮어쓰지 않습니다.
    if (expectedRevision === undefined) await loadInitialRevision();
    const next = await encryptSnapshot(plaintext);
    await compareAndWrite(expectedRevision!, next, fence);
    expectedRevision = next.revision;
  }).catch(error => {
    if (error instanceof Error && /다른 탭|삭제 이후|자동 저장/.test(error.message)) throw error;
    throw new Error('일반모드 자료를 저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인해주세요.');
  });
  pendingSave = operation;
  return operation;
};

const loadInitialRevision = async (): Promise<void> => {
  const record = await readRecord();
  if (record) { if (!isCleared(record)) await decryptRecord(record); expectedRevision = record.revision; }
  else {
    // 아직 이전하지 않은 세션 자료가 있다면 직접 저장 호출로 덮어쓰지 않습니다.
    if (globalThis.sessionStorage.getItem(DATA_KEY) !== null) throw new Error('먼저 기존 저장 자료를 불러와 주세요.');
    expectedRevision = null;
  }
};

export const clearStandalone = (): Promise<void> => {
  // 대기 중인 이전 자동 저장과 암호화를 즉시 무효화해 삭제 후 부활을 막습니다.
  const fence = ++generation;
  const operation = pendingSave.catch(() => undefined).then(async () => {
    if (fence !== generation) throw conflict();
    const current = await readRecord();
    const revision = expectedRevision === undefined ? current?.revision ?? null : expectedRevision;
    // 학생 자료와 키는 제거하되 삭제 세대만 남겨 오래된 빈 탭의 저장도 거부합니다.
    const tombstone: ClearedWorkspace = { version: 2, revision: globalThis.crypto.randomUUID(), cleared: true };
    await compareAndWrite(revision, tombstone, fence);
    expectedRevision = tombstone.revision; blocked = false;
    // 명시적으로 삭제한 브라우저에서 기존 탭 저장 자료가 다시 이전되지 않게 합니다.
    globalThis.sessionStorage.removeItem(DATA_KEY); globalThis.sessionStorage.removeItem(KEY_KEY);
  });
  pendingSave = operation;
  return operation;
};
