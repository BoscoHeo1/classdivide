import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue, off } from "firebase/database";
import { GradeWorkspace, Student, PlacementResult, ClassSettings } from "./types";

const firebaseConfig = {
  apiKey: "AIzaSyBHGRJvSZ1JFI-sq1lsN-APIyIMr8c5aeI",
  authDomain: "gogo-forward.firebaseapp.com",
  databaseURL: "https://gogo-forward-default-rtdb.firebaseio.com",
  projectId: "gogo-forward",
  storageBucket: "gogo-forward.firebasestorage.app",
  messagingSenderId: "859594059934",
  appId: "1:859594059934:web:309906a4128638b9f24b8f"
};

const app = initializeApp(firebaseConfig, "classdivide-collab");
export const rtdb = getDatabase(app);

const sanitizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");

// 1. 방 개설 (호스트)
export const createWorkspace = async (
  rawCode: string,
  name: string,
  password: string,
  settings: ClassSettings,
  hostId: string
): Promise<string> => {
  const code = sanitizeCode(rawCode);
  if (!code) throw new Error("방 코드를 입력해주세요.");
  if (!name.trim()) throw new Error("학교/학년명을 입력해주세요.");
  if (!password.trim()) throw new Error("관리자 실행 비밀번호를 설정해주세요.");

  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const snapshot = await get(roomRef);
  if (snapshot.exists()) {
    throw new Error(`이미 존재하는 방 코드(${code})입니다. 다른 코드를 사용해주세요.`);
  }

  const newWorkspace: GradeWorkspace = {
    code,
    name: name.trim(),
    password: password.trim(),
    currentClassCount: settings.currentClassCount,
    nextClassCount: settings.nextClassCount,
    reductionCount: settings.reductionCount,
    placementOrder: settings.placementOrder,
    students: [],
    classStatus: {},
    step: 1,
    hostId,
    updatedAt: Date.now()
  };

  // 1반부터 각 반 상태 초기화
  for (let c = 1; c <= settings.currentClassCount; c++) {
    newWorkspace.classStatus[c] = { completed: false };
  }

  await set(roomRef, newWorkspace);
  return code;
};

// 2. 방 정보 조회 (입장)
export const getWorkspace = async (rawCode: string): Promise<GradeWorkspace | null> => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return null;
  return snapshot.val() as GradeWorkspace;
};

// 3. 실시간 동기화 구독
export const subscribeWorkspace = (
  rawCode: string,
  onUpdate: (workspace: GradeWorkspace | null) => void
) => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const unsubscribe = onValue(roomRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val();
      // ensure students array
      if (!data.students) data.students = [];
      if (!data.classStatus) data.classStatus = {};
      onUpdate(data as GradeWorkspace);
    } else {
      onUpdate(null);
    }
  });

  return () => off(roomRef, 'value', unsubscribe);
};

// 4. 담임선생님이 자기 반 학생 업데이트
export const updateClassStudents = async (
  rawCode: string,
  classNum: number,
  newClassStudents: Student[],
  isCompleted: boolean,
  teacherName?: string
) => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("존재하지 않는 방입니다.");

  const ws = snapshot.val() as GradeWorkspace;
  const currentStudents: Student[] = ws.students || [];

  // 기존 학생 목록에서 해당 반 학생만 필터링하고 새 학생 목록으로 교체
  const otherClassStudents = currentStudents.filter(s => s.현학급 !== classNum);
  const updatedAllStudents = [...otherClassStudents, ...newClassStudents];

  // ID 재부여 (1부터 고유 식별)
  updatedAllStudents.forEach((s, idx) => {
    s.id = idx + 1;
  });

  const classStatus = ws.classStatus || {};
  classStatus[classNum] = {
    completed: isCompleted,
    teacherName: teacherName || classStatus[classNum]?.teacherName || `${classNum}반 담임`,
    updatedAt: Date.now()
  };

  await update(roomRef, {
    students: updatedAllStudents,
    classStatus,
    updatedAt: Date.now()
  });
};

// 5. 관리자(학년부장)가 최종 학급편성 실행 및 결과 클라우드 저장
export const executeWorkspacePlacement = async (
  rawCode: string,
  inputPassword: string,
  result: PlacementResult,
  settings: ClassSettings
) => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("존재하지 않는 방입니다.");

  const ws = snapshot.val() as GradeWorkspace;
  if (ws.password !== inputPassword.trim()) {
    throw new Error("관리자 실행 비밀번호가 올바르지 않습니다.");
  }

  await update(roomRef, {
    step: 3,
    result,
    currentClassCount: settings.currentClassCount,
    nextClassCount: settings.nextClassCount,
    reductionCount: settings.reductionCount,
    placementOrder: settings.placementOrder,
    updatedAt: Date.now()
  });
};

// 6. 결과 수동 변경 동기화 (맞교환 등 관리자 조정 결과 반영)
export const updateWorkspaceResult = async (
  rawCode: string,
  updatedResult: PlacementResult
) => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  await update(roomRef, {
    result: updatedResult,
    updatedAt: Date.now()
  });
};

// 7. 배정 초기화 / 재배정 모드로 되돌리기 (관리자 전용)
export const resetWorkspaceToInput = async (
  rawCode: string,
  inputPassword: string
) => {
  const code = sanitizeCode(rawCode);
  const roomRef = ref(rtdb, `classdivide_workspaces/${code}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("존재하지 않는 방입니다.");

  const ws = snapshot.val() as GradeWorkspace;
  if (ws.password !== inputPassword.trim()) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }

  await update(roomRef, {
    step: 1,
    result: null,
    updatedAt: Date.now()
  });
};
