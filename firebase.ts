import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDatabase, ref, set, get, update, onValue, serverTimestamp } from "firebase/database";
import { GradeWorkspace, Student, PlacementResult, ClassSettings, TwinGroupConfig } from "./types";

const firebaseConfig = {
  apiKey: "AIzaSyCJNtARfZj7lndDBR6UUTAJzwClOCndclY",
  authDomain: "class-divide.firebaseapp.com",
  databaseURL: "https://class-divide-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "class-divide",
  storageBucket: "class-divide.firebasestorage.app",
  messagingSenderId: "992756245827",
  appId: "1:992756245827:web:a62631fdeeb1acee5ffbf6"
};
const app = initializeApp(firebaseConfig, "classdivide-collab");
export const rtdb = getDatabase(app);
const auth = getAuth(app);
const recoveryFunctions = getFunctions(app, "asia-southeast1");
export interface AdminRecoveryCode { roomCode: string; recoveryCode: string; version: number; }
export type CollaborationWorkspace = Omit<GradeWorkspace, 'password'>;
export interface RoomMember { role: 'admin' | 'teacher'; active: boolean; classNum: number; }
export interface JoinRequest { classNum: number; teacherName: string; requestedAt: number; }
let authentication: Promise<string> | undefined;

// Called by collaboration only. Firebase persistence, not a localStorage flag, identifies users.
export const ensureAnonymousUser = (): Promise<string> => {
  if (!authentication) {
    authentication = (async () => {
      await auth.authStateReady();
      return (auth.currentUser || (await signInAnonymously(auth)).user).uid;
    })().finally(() => { authentication = undefined; });
  }
  return authentication;
};
const sanitizeCode = (code: string) => {
  const value = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(value)) throw new Error('방 코드는 영문·숫자·밑줄·하이픈 1~40자로 입력해주세요.');
  return value;
};
// Preserve optional-field omission for inputs AND nested placement results.
const normalize = (value: any): any => {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : normalize(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, normalize(item)]));
  }
  return value;
};
const memberPath = (code: string, uid: string) => `roomMembers/${code}/${uid}`;
export const getOwnMembership = async (rawCode: string): Promise<RoomMember | null> => {
  const uid = await ensureAnonymousUser();
  return (await get(ref(rtdb, memberPath(sanitizeCode(rawCode), uid)))).val();
};
export const subscribeOwnMembership = (rawCode: string, uid: string,
  onUpdate: (member: RoomMember | null) => void, onError: (error: Error) => void) =>
  onValue(ref(rtdb, memberPath(sanitizeCode(rawCode), uid)), snapshot => onUpdate(snapshot.val()), onError);
const requireMember = async (rawCode: string, admin = false) => {
  const member = await getOwnMembership(rawCode);
  if (!member?.active || (admin && member.role !== 'admin')) throw new Error('이 방의 승인된 권한이 필요합니다.');
  return member;
};

// Bootstrap is allowed by Rules only for the immutable host UID of a new room.
export const restoreCreatorMembership = async (rawCode: string) => {
  const code = sanitizeCode(rawCode);
  const uid = await ensureAnonymousUser();
  const existing = await getOwnMembership(code);
  if (existing?.active) return existing;
  await set(ref(rtdb, memberPath(code, uid)), { role: 'admin', active: true, classNum: 0 });
  return { role: 'admin', active: true, classNum: 0 } as RoomMember;
};
export const createWorkspace = async (rawCode: string, name: string, settings: ClassSettings): Promise<string> => {
  const code = sanitizeCode(rawCode);
  const uid = await ensureAnonymousUser();
  if (!name.trim()) throw new Error('학교/학년명을 입력해주세요.');
  if (await getOwnMembership(code)) throw new Error('이미 참여한 방 코드입니다. 재입장하거나 다른 코드를 사용해주세요.');
  const classStatus: CollaborationWorkspace['classStatus'] = {};
  for (let c = 1; c <= settings.currentClassCount; c++) classStatus[c] = { completed: false };
  // No preflight workspace read: non-members cannot read even a known code.
  await set(ref(rtdb, `classdivide_workspaces/${code}`), {
    code, name: name.trim(), hostId: uid,
    currentClassCount: settings.currentClassCount, nextClassCount: settings.nextClassCount,
    reductionCount: settings.reductionCount, placementOrder: settings.placementOrder,
    classStatus, step: 1, updatedAt: Date.now()
  });
  await restoreCreatorMembership(code);
  return code;
};
export const requestRoomMembership = async (rawCode: string, classNum: number, teacherName: string) => {
  const code = sanitizeCode(rawCode);
  const uid = await ensureAnonymousUser();
  if ((await getOwnMembership(code))?.active) return;
  const requestRef = ref(rtdb, `roomJoinRequests/${code}/${uid}`);
  // Own pending request is readable; the room itself is not.
  if ((await get(requestRef)).exists()) return;
  await set(requestRef, { classNum, teacherName: teacherName.trim() || `${classNum}반 담임`, requestedAt: serverTimestamp() });
};
export const subscribeOwnRequest = (code: string, uid: string, callback: (request: JoinRequest | null) => void,
  onError: (error: Error) => void) =>
  onValue(ref(rtdb, `roomJoinRequests/${sanitizeCode(code)}/${uid}`), s => callback(s.val()), onError);
export const subscribeJoinRequests = (code: string, callback: (requests: Record<string, JoinRequest>) => void,
  onError: (error: Error) => void) =>
  onValue(ref(rtdb, `roomJoinRequests/${sanitizeCode(code)}`), s => callback(s.val() || {}), onError);
export const approveJoinRequest = async (rawCode: string, uid: string, request: JoinRequest) => {
  const code = sanitizeCode(rawCode);
  await requireMember(code, true);
  await update(ref(rtdb), {
    [memberPath(code, uid)]: { role: 'teacher', active: true, classNum: request.classNum },
    [`roomJoinRequests/${code}/${uid}`]: null
  });
};
export const cancelJoinRequest = async (rawCode: string, uid?: string) => {
  const ownUid = await ensureAnonymousUser();
  await set(ref(rtdb, `roomJoinRequests/${sanitizeCode(rawCode)}/${uid || ownUid}`), null);
};

// Keep the existing flat-array UI/algorithm contract; each class owns a separate DB path.
const toWorkspace = (data: any): CollaborationWorkspace | null => {
  if (!data) return null;
  const students: Student[] = Object.entries(data.classInputs || {}).sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([classNum, rows]) => Object.values(rows || {}).filter(Boolean).map((student: any, index) => ({
      ...student, id: Number(classNum) * 1000000 + index + 1, 현학급: Number(classNum)
    })));
  const rawTwinGroups = data.twinGroups
    ? (Array.isArray(data.twinGroups) ? data.twinGroups : Object.values(data.twinGroups))
    : [];
  const twinGroups: TwinGroupConfig[] = rawTwinGroups.filter(Boolean).map((g: any) => ({
    id: String(g.id || ''),
    option: (g.option === '동일' ? '동일' : '분리') as '분리' | '동일',
    studentIds: Array.isArray(g.studentIds)
      ? g.studentIds.map(Number)
      : Object.values(g.studentIds || {}).map(Number)
  }));
  return { ...data, students, classStatus: data.classStatus || {}, twinGroups };
};
export const getWorkspace = async (rawCode: string): Promise<CollaborationWorkspace | null> => {
  await requireMember(rawCode);
  return toWorkspace((await get(ref(rtdb, `classdivide_workspaces/${sanitizeCode(rawCode)}`))).val());
};
export const subscribeWorkspace = (rawCode: string, onUpdate: (workspace: CollaborationWorkspace | null) => void,
  onError: (error: Error) => void) =>
  onValue(ref(rtdb, `classdivide_workspaces/${sanitizeCode(rawCode)}`), s => onUpdate(toWorkspace(s.val())), onError);

export const updateClassStudents = async (rawCode: string, classNum: number, newClassStudents: Student[],
  isCompleted: boolean, teacherName?: string) => {
  const code = sanitizeCode(rawCode);
  const member = await requireMember(code);
  if (member.role !== 'admin' && member.classNum !== classNum) throw new Error('담당 학급만 수정할 수 있습니다.');
  if (newClassStudents.length >= 1000000) throw new Error('학급 학생 수가 너무 많습니다.');
  const path = `classdivide_workspaces/${code}`;
  const status = (await get(ref(rtdb, `${path}/classStatus/${classNum}`))).val();
  await update(ref(rtdb), normalize({
    [`${path}/classInputs/${classNum}`]: newClassStudents.map((student, index) => ({
      ...student, id: classNum * 1000000 + index + 1, 현학급: classNum
    })),
    [`${path}/classStatus/${classNum}`]: {
      completed: isCompleted, teacherName: teacherName || status?.teacherName || `${classNum}반 담임`, updatedAt: Date.now()
    }
  }));
};
const adminUpdate = async (rawCode: string, changes: object) => {
  await requireMember(rawCode, true);
  await update(ref(rtdb, `classdivide_workspaces/${sanitizeCode(rawCode)}`), normalize({ ...changes, updatedAt: Date.now() }));
};
export const updateWorkspaceTwinGroups = async (rawCode: string, twinGroups: TwinGroupConfig[]) =>
  adminUpdate(rawCode, { twinGroups });
export const executeWorkspacePlacement = async (rawCode: string, result: PlacementResult, settings: ClassSettings) =>
  adminUpdate(rawCode, { step: 3, result, currentClassCount: settings.currentClassCount,
    nextClassCount: settings.nextClassCount, reductionCount: settings.reductionCount, placementOrder: settings.placementOrder,
    twinGroups: settings.twinGroups || [] });
export const updateWorkspaceResult = async (rawCode: string, result: PlacementResult) => adminUpdate(rawCode, { result });
export const resetWorkspaceToInput = async (rawCode: string) => adminUpdate(rawCode, { step: 1, result: null });
export const updateWorkspaceSettings = async (rawCode: string, settings: {
  name?: string; currentClassCount?: number; nextClassCount?: number; reductionCount?: number; placementOrder?: 'zigzag' | 'linear';
}) => {
  await requireMember(rawCode, true);
  const ws = await getWorkspace(rawCode);
  if (!ws) throw new Error('존재하지 않는 방입니다.');
  // Do not silently hide already-uploaded classes when reducing the class count.
  if (settings.currentClassCount !== undefined && ws.students.some(s => s.현학급 > settings.currentClassCount!)) {
    throw new Error('줄이려는 학급에 학생이 남아 있습니다. 해당 학급 명단을 먼저 정리해주세요.');
  }
  const changes: Record<string, unknown> = { ...settings };
  if (settings.name !== undefined) changes.name = settings.name.trim();
  if (settings.currentClassCount !== undefined) {
    for (let c = 1; c <= settings.currentClassCount; c++) {
      if (!ws.classStatus[c]) changes[`classStatus/${c}`] = { completed: false };
    }
    for (const key of Object.keys(ws.classStatus)) {
      if (Number(key) > settings.currentClassCount) changes[`classStatus/${key}`] = null;
    }
  }
  await adminUpdate(rawCode, changes);
};
// Recovery plaintext is passed only to callable Functions and returned to in-memory UI state.
export const issueAdminRecoveryCode = async (rawCode: string, replaceExisting = false): Promise<AdminRecoveryCode> => {
  await ensureAnonymousUser();
  const response = await httpsCallable<{ roomCode: string; replaceExisting: boolean }, AdminRecoveryCode>(
    recoveryFunctions, 'issueAdminRecoveryCode'
  )({ roomCode: sanitizeCode(rawCode), replaceExisting });
  return response.data;
};
export const recoverWorkspaceAdmin = async (rawCode: string, recoveryCode: string): Promise<AdminRecoveryCode> => {
  await ensureAnonymousUser();
  const response = await httpsCallable<{ roomCode: string; recoveryCode: string }, AdminRecoveryCode>(
    recoveryFunctions, 'recoverWorkspaceAdmin'
  )({ roomCode: sanitizeCode(rawCode), recoveryCode: recoveryCode.trim() });
  return response.data;
};
export const deleteWorkspace = async (rawCode: string) => {
  await ensureAnonymousUser();
  // Server atomically removes room data, memberships, secrets and recovery history.
  await httpsCallable(recoveryFunctions, 'deleteWorkspaceSecure')({ roomCode: sanitizeCode(rawCode) });
};
