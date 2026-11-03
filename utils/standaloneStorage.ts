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
let pendingSave: Promise<void> = Promise.resolve();

const encode = (bytes: Uint8Array): string => {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return globalThis.btoa(value);
};

const decode = (value: string): Uint8Array =>
  Uint8Array.from(globalThis.atob(value), character => character.charCodeAt(0));

// 키와 자료는 같은 탭에만 남습니다. 서버 전송 없이 새로고침을 지원하며,
// 같은 출처에서 실행되는 악성 스크립트까지 막는 암호화는 아닙니다.
const encryptionKey = async (): Promise<CryptoKey> => {
  const storage = globalThis.sessionStorage;
  let saved = storage.getItem(KEY_KEY);
  if (!saved) {
    // 복호화 키가 없으면 기존 암호문을 덮어쓰거나 임의 초기화하지 않습니다.
    if (storage.getItem(DATA_KEY) !== null) throw new Error('저장된 자료의 복호화 키를 찾을 수 없습니다.');
    saved = encode(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    storage.setItem(KEY_KEY, saved);
  }
  const bytes = decode(saved);
  if (bytes.length !== 32) throw new Error('저장된 자료의 복호화 키를 확인할 수 없습니다.');
  return globalThis.crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
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

export const loadStandalone = async (): Promise<StandaloneSnapshot | null> => {
  // 직전 저장이 실패했더라도 마지막으로 정상 저장된 자료는 복원할 수 있습니다.
  await pendingSave.catch(() => undefined);
  const saved = globalThis.sessionStorage.getItem(DATA_KEY);
  if (saved === null) return null;
  try {
    const envelope = JSON.parse(saved);
    if (envelope.version !== 1 || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
      throw new Error('지원하지 않는 저장 형식입니다.');
    }
    const key = await encryptionKey();
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(envelope.iv) }, key, decode(envelope.ciphertext)
    );
    return validateSnapshot(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error('일반모드 저장 자료를 복원하지 못했습니다. 기존 저장 자료는 보존되었습니다.');
  }
};

export const saveStandalone = (snapshot: StandaloneSnapshot): Promise<void> => {
  let plaintext: Uint8Array;
  try {
    // 대기 중 화면 상태가 바뀌어도 호출 시점의 자료를 순서대로 저장합니다.
    plaintext = new TextEncoder().encode(JSON.stringify(validateSnapshot(snapshot)));
  } catch {
    return Promise.reject(new Error('일반모드 자료를 저장할 수 있는 형식으로 변환하지 못했습니다.'));
  }
  const operation = pendingSave.catch(() => undefined).then(async () => {
    try {
      const key = await encryptionKey();
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      // 암호화에 성공한 완성본만 한 번에 교체합니다. 실패 시 이전 자료가 남습니다.
      globalThis.sessionStorage.setItem(DATA_KEY, JSON.stringify({
        version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext))
      }));
    } catch {
      throw new Error('일반모드 자료를 저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인해주세요.');
    }
  });
  pendingSave = operation;
  return operation;
};
