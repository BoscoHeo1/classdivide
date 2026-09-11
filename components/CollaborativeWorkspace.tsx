import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, ShieldCheck, Crown, UserCheck, Key, LogOut, CheckCircle2, Settings, AlertOctagon, 
  Clock, Upload, Plus, Trash2, ArrowRight, ArrowLeft, RefreshCw, 
  Layers, Sparkles, Copy, Check, Download, AlertTriangle, FileSpreadsheet, Lock
} from 'lucide-react';
import { Student, ClassSettings, PlacementResult } from '../types';
import { 
  createWorkspace, subscribeWorkspace, updateClassStudents, 
  executeWorkspacePlacement, updateWorkspaceResult, resetWorkspaceToInput, 
  updateWorkspaceSettings, deleteWorkspace, ensureAnonymousUser, getOwnMembership,
  subscribeOwnMembership, requestRoomMembership, subscribeOwnRequest, subscribeJoinRequests,
  approveJoinRequest, cancelJoinRequest, restoreCreatorMembership, CollaborationWorkspace, RoomMember, JoinRequest,
  issueAdminRecoveryCode, recoverWorkspaceAdmin, AdminRecoveryCode 
} from '../firebase';
import { parseExcel, generateTemplate, downloadResultsByNewClass, downloadResultsByOldClass } from '../utils/excel';
import { runPlacementAlgorithm } from '../utils/algorithm';
import ClassTable from './ClassTable';
import { PlacementResultDashboard } from './PlacementResultDashboard';

interface CollaborativeWorkspaceProps {
  onBackToStandalone?: () => void;
}

export const CollaborativeWorkspace: React.FC<CollaborativeWorkspaceProps> = ({ onBackToStandalone }) => {
  const [firebaseUid, setFirebaseUid] = useState('');
  const [membership, setMembership] = useState<RoomMember | null>(null);
  const [pendingRequest, setPendingRequest] = useState<JoinRequest | null>(null);
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest>>({});
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryDisplay, setRecoveryDisplay] = useState<AdminRecoveryCode | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);


  // 1. 방 접속 및 상태
  const [currentCode, setCurrentCode] = useState<string>(() => localStorage.getItem('classdivide_last_room') || '');
  const [workspace, setWorkspace] = useState<CollaborationWorkspace | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // 2. 권한 상태
  const [isHost, setIsHost] = useState<boolean>(false);
  const [showAdminAuthModal, setShowAdminAuthModal] = useState<boolean>(false);

  // 2-1. 방 설정 수정 및 삭제 모달 상태
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editCurrentClasses, setEditCurrentClasses] = useState<number>(6);
  const [editNextClasses, setEditNextClasses] = useState<number>(6);
  const [editReduction, setEditReduction] = useState<number>(2);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [deleteCodeInput, setDeleteCodeInput] = useState<string>('');

  // 3. 방 개설 폼
  const [createName, setCreateName] = useState<string>('');
  const [createCode, setCreateCode] = useState<string>('');
  const [createCurrentClasses, setCreateCurrentClasses] = useState<number>(6);
  const [createNextClasses, setCreateNextClasses] = useState<number>(6);

  // 4. 방 입장 폼
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [myClassNum, setMyClassNum] = useState<number>(1);
  const [teacherNameInput, setTeacherNameInput] = useState<string>('');
  const [joinRole, setJoinRole] = useState<'teacher' | 'host'>('teacher');

  // 5. 작업 탭
  const [activeClassTab, setActiveClassTab] = useState<number>(1); // 0 = 전체 취합 현황판, 1~N = 각 반
  const [resultActiveTab, setResultActiveTab] = useState<string>('ALL');
  const [resultViewMode, setResultViewMode] = useState<'newClass' | 'oldClass'>('newClass');
  const [filterSpecialOnly, setFilterSpecialOnly] = useState<boolean>(false);
  const [swapCandidate, setSwapCandidate] = useState<Student | null>(null);

  // 6. 단일 학생 추가 임시 폼
  const [showAddStudentModal, setShowAddStudentModal] = useState<boolean>(false);
  const [newStudent, setNewStudent] = useState<Partial<Student>>({
    성별: '남성',
    생활지도: '',
    학습부진: false,
    학생선수: false,
    통합학급: false,
    학부모민원: false,
    쌍둥이: false,
    전출예정: false
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Authentication starts only when this collaboration component is mounted.
  useEffect(() => {
    let cancelled = false;
    ensureAnonymousUser().then(uid => { if (!cancelled) setFirebaseUid(uid); })
      .catch(err => { if (!cancelled) setError('익명 인증 실패: ' + err.message); });
    const roomParam = new URLSearchParams(window.location.search).get('room');
    if (roomParam && /^[A-Za-z0-9_-]{1,40}$/.test(roomParam)) {
      setJoinCodeInput(roomParam.toUpperCase());
      setCurrentCode(roomParam.toUpperCase());
    }
    return () => { cancelled = true; };
  }, []);

  // Only own membership/request is readable before approval. Never subscribe to the room first.
  useEffect(() => {
    setWorkspace(null);
    setMembership(null);
    setIsHost(false);
    setPendingRequest(null);
    setJoinRequests({});
    if (!currentCode || !firebaseUid) return;
    let stopRoom: (() => void) | undefined;
    let stopRequests: (() => void) | undefined;
    setLoading(true);
    const onError = (err: Error) => {
      stopRoom?.(); stopRoom = undefined;
      stopRequests?.(); stopRequests = undefined;
      setWorkspace(null); setMembership(null); setIsHost(false); setLoading(false);
      setError('방 접근 확인 실패: ' + err.message);
    };
    const stopMember = subscribeOwnMembership(currentCode, firebaseUid, member => {
      stopRoom?.(); stopRoom = undefined;
      stopRequests?.(); stopRequests = undefined;
      setMembership(member);
      setIsHost(member?.active === true && member.role === 'admin');
      setJoinRequests({});
      if (!member?.active) {
        setWorkspace(null); setLoading(false);
        setJoinCodeInput(currentCode);
        return;
      }
      setActiveClassTab(member.role === 'admin' ? 0 : member.classNum);
      stopRoom = subscribeWorkspace(currentCode, updated => {
        setWorkspace(updated); setLoading(false);
        if (updated) localStorage.setItem('classdivide_last_room', currentCode);
        else setError('방이 삭제되었습니다.');
      }, onError);
      if (member.role === 'admin') stopRequests = subscribeJoinRequests(currentCode, setJoinRequests, onError);
    }, onError);
    const stopRequest = subscribeOwnRequest(currentCode, firebaseUid, setPendingRequest, onError);
    return () => { stopMember(); stopRequest(); stopRoom?.(); stopRequests?.(); };
  }, [currentCode, firebaseUid]);

  // 링크 복사
  const handleCopyInviteLink = () => {
    if (!workspace) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${workspace.code}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const showRecoveryCode = (value: AdminRecoveryCode) => {
    setRecoveryDisplay(value);
    setRecoveryCopied(false);
  };

  const handleIssueRecoveryCode = async () => {
    if (!workspace || !isHost || recoveryBusy) return;
    if (!window.confirm('관리자 복구 코드를 발급합니다. 이미 발급한 코드가 있다면 즉시 사용할 수 없게 됩니다. 계속하시겠습니까?')) return;
    setRecoveryBusy(true);
    try {
      showRecoveryCode(await issueAdminRecoveryCode(workspace.code, true));
    } catch (err: any) {
      // A lost response may still mean issuance committed. Never redisplay a possibly obsolete code.
      setRecoveryDisplay(null);
      alert('복구 코드 발급을 확인하지 못했습니다. 잠시 후 재발급해주세요. ' + (err.message || ''));
    } finally { setRecoveryBusy(false); }
  };

  // 방 개설 (호스트)
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryBusy) return;
    if (!createCode.trim() || !createName.trim()) {
      alert('학교/학년명과 방 코드를 입력해주세요.');
      return;
    }

    setLoading(true);
    setRecoveryBusy(true);
    setError(null);
    try {
      const code = await createWorkspace(
        createCode,
        createName,
        {
          currentClassCount: createCurrentClasses,
          nextClassCount: createNextClasses,
          normalCapacity: 24,
          reductionCount: 2,
          placementOrder: 'zigzag'
        }
      );

      setFirebaseUid(await ensureAnonymousUser());
      setCurrentCode(code);
      try {
        showRecoveryCode(await issueAdminRecoveryCode(code));
      } catch {
        alert('방은 정상 개설됐지만 복구 코드 발급을 확인하지 못했습니다. 관리자 화면의 복구 코드 발급/재발급을 이용해주세요.');
      }
    } catch (err: any) {
      setError(err.message || '방 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setRecoveryBusy(false);
    }
  };

  // 방 입장 (담임교사 또는 학년부장 재입장)
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryBusy) return;
    if (!joinCodeInput.trim()) {
      alert('방 코드를 입력해주세요.');
      return;
    }

    setLoading(true);
    setRecoveryBusy(true);
    setError(null);
    try {
      const uid = await ensureAnonymousUser();
      setFirebaseUid(uid);
      const code = joinCodeInput.trim().toUpperCase();
      let member = await getOwnMembership(code);
      if (joinRole === 'host' && recoveryInput.trim()) {
        let receivedCode = false;
        try {
          const recovered = await recoverWorkspaceAdmin(code, recoveryInput);
          showRecoveryCode(recovered);
          receivedCode = true;
          member = await getOwnMembership(code);
        } catch (err: any) {
          if (!['functions/unavailable', 'functions/internal', 'functions/deadline-exceeded', 'functions/unknown'].includes(err?.code)) throw err;
          // Recovery may have committed even if its response was lost. Authority is still
          // confirmed from roomMembers; the old code is never accepted by a client fallback.
          const confirmed = await getOwnMembership(code).catch(() => null);
          if (!confirmed?.active || confirmed.role !== 'admin') throw err;
          member = confirmed;
          if (!receivedCode) alert('현재 계정의 관리자 권한을 확인했습니다. 새 복구 코드를 받지 못했다면 관리자 화면에서 재발급해주세요.');
        } finally { setRecoveryInput(''); }
      } else if (joinRole === 'host' && !member?.active) {
        // Only the original host can complete an interrupted first-time registration.
        try { member = await restoreCreatorMembership(code); }
        catch { throw new Error('이 브라우저의 관리자 권한을 확인할 수 없습니다. 보관한 관리자 복구 코드를 입력해주세요.'); }
      }
      if (joinRole === 'host' && member?.role !== 'admin') throw new Error('이 계정은 이 방의 관리자가 아닙니다.');
      if (!member?.active) await requestRoomMembership(code, myClassNum, teacherNameInput);
      setCurrentCode(code);
    } catch (err: any) {
      setError(err.message || '방 입장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setRecoveryBusy(false);
    }
  };

  // Role information is supplied by the membership subscription, never by a password or browser flag.
  const handleAdminAuth = () => {
    setShowAdminAuthModal(false);
    alert('관리자 권한은 서버에 등록된 계정으로 확인됩니다. 다른 기기에서는 보관한 관리자 복구 코드로 복구할 수 있습니다.');
  };

  const handleReviewRequest = async (uid: string, request: JoinRequest, approve: boolean) => {
    if (!workspace || !isHost) return;
    if (approve && !window.confirm(`${request.teacherName} (${request.classNum}반)의 실제 참여자를 확인하셨나요?\n승인하면 이 방의 학생 데이터 전체를 열람하고 담당 반을 수정할 수 있습니다.`)) return;
    setLoading(true);
    try {
      if (approve) await approveJoinRequest(workspace.code, uid, request);
      else await cancelJoinRequest(workspace.code, uid);
    } catch (err: any) { alert('참여 승인 처리 실패: ' + err.message); }
    finally { setLoading(false); }
  };

  // 설정 모달 열기 (기존 값 주입)
  const handleOpenSettingsModal = () => {
    if (!workspace) return;
    setEditName(workspace.name);
    setEditCurrentClasses(workspace.currentClassCount);
    setEditNextClasses(workspace.nextClassCount);
    setEditReduction(workspace.reductionCount);
    setShowDeleteConfirm(false);
    setDeleteCodeInput('');
    setShowSettingsModal(true);
  };

  // 방 설정 저장 처리
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !isHost) return;

    setLoading(true);
    try {
      await updateWorkspaceSettings(workspace.code, {
        name: editName,
        currentClassCount: editCurrentClasses,
        nextClassCount: editNextClasses,
        reductionCount: editReduction
      });
      setShowSettingsModal(false);
      alert('⚙️ 학년 설정이 성공적으로 변경되었습니다! 동학년 모든 화면에 즉시 반영됩니다.');
    } catch (err: any) {
      alert('설정 변경 실패: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  };

  // 방 영구 삭제 처리
  const handleDeleteRoom = async () => {
    if (!workspace || !isHost) return;
    if (deleteCodeInput.trim().toUpperCase() !== workspace.code) {
      alert('확인을 위해 현재 방 코드를 정확히 입력해주세요.');
      return;
    }

    if (!window.confirm(`🚨 경고: 정말로 [${workspace.name}] 방을 영구 삭제하시겠습니까?\n\n등록된 모든 학생 명단과 배정 결과가 완전히 삭제되며 되돌릴 수 없습니다!`)) {
      return;
    }

    setLoading(true);
    try {
      await deleteWorkspace(workspace.code);
      localStorage.removeItem('classdivide_last_room');
      setCurrentCode('');
      setRecoveryDisplay(null);
      setRecoveryInput('');
      setWorkspace(null);
      setIsHost(false);
      setMembership(null);
      setShowSettingsModal(false);
      alert('🗑️ 협업 방이 성공적으로 삭제되었습니다.');
    } catch (err: any) {
      alert('방 삭제 실패: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  };

  // 방 나가기
  const handleLeaveRoom = () => {
    if (window.confirm('현재 협업 방에서 나가시겠습니까?')) {
      setCurrentCode('');
      setRecoveryDisplay(null);
      setRecoveryInput('');
      setWorkspace(null);
      setIsHost(false);
      setMembership(null);
      localStorage.removeItem('classdivide_last_room');
    }
  };

  // 현재 탭의 반 학생들
  const currentTabStudents = (workspace?.students || []).filter(s => s.현학급 === activeClassTab);

  const canEditClass = membership?.active === true && (isHost || membership.classNum === activeClassTab) && workspace?.step === 1;

  // 내 반 엑셀 업로드 처리
  const handleClassExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspace || !canEditClass) return;

    setLoading(true);
    try {
      const parsed = await parseExcel(file);
      const formatted = parsed.map((s, idx) => ({
        ...s,
        현학급: activeClassTab,
        번호: s.번호 || idx + 1
      }));

      await updateClassStudents(workspace.code, activeClassTab, formatted, true, teacherNameInput);
      alert(`${activeClassTab}반 학생 ${formatted.length}명이 성공적으로 등록되었습니다!`);
    } catch (err: any) {
      alert('엑셀 파일을 읽는 중 오류가 발생했습니다: ' + (err.message || ''));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 반 완료 상태 토글
  const handleToggleClassComplete = async () => {
    if (!canEditClass) return;
    if (!workspace) return;
    const currentCompleted = workspace.classStatus?.[activeClassTab]?.completed || false;
    try {
      await updateClassStudents(
        workspace.code,
        activeClassTab,
        currentTabStudents,
        !currentCompleted,
        teacherNameInput
      );
    } catch (err: any) { alert('완료 상태 저장 실패: ' + err.message); }
  };

  // 단일 학생 추가
  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !canEditClass || !newStudent.이름) return;

    const studentToAdd: Student = {
      id: Date.now(),
      학년: workspace.name,
      현학급: activeClassTab,
      번호: currentTabStudents.length + 1,
      이름: newStudent.이름,
      성별: (newStudent.성별 as '남성' | '여성') || '남성',
      생년월일: newStudent.생년월일 || '',
      학습부진: !!newStudent.학습부진,
      생활지도: (newStudent.생활지도 as any) || '',
      학생선수: !!newStudent.학생선수,
      통합학급: !!newStudent.통합학급,
      학부모민원: !!newStudent.학부모민원,
      쌍둥이: !!newStudent.쌍둥이,
      쌍둥이옵션: newStudent.쌍둥이옵션,
      전출예정: !!newStudent.전출예정,
      분리배정: newStudent.분리배정 || ''
    };

    const updated = [...currentTabStudents, studentToAdd];
    try {
      await updateClassStudents(workspace.code, activeClassTab, updated, false, teacherNameInput);
    } catch (err: any) { alert('학생 명단 저장 실패: ' + err.message); return; }
    setShowAddStudentModal(false);
    setNewStudent({
      성별: '남성',
      생활지도: '',
      학습부진: false,
      학생선수: false,
      통합학급: false,
      학부모민원: false,
      쌍둥이: false,
      전출예정: false
    });
  };

  // 학생 삭제
  const handleDeleteStudent = async (studentId: number) => {
    if (!workspace || !canEditClass || !window.confirm('이 학생을 삭제하시겠습니까?')) return;
    const updated = currentTabStudents.filter(s => s.id !== studentId);
    try {
      await updateClassStudents(workspace.code, activeClassTab, updated, false, teacherNameInput);
    } catch (err: any) { alert('학생 명단 저장 실패: ' + err.message); return; }
  };

  // 👑 관리자 전용: 배정 알고리즘 실행
  const handleRunCollabPlacement = async () => {
    if (!workspace) return;
    if (!isHost) {
      alert('학급편성 실행은 방을 개설한 학년부장(관리자) 선생님만 가능합니다.');
      return;
    }

    if (workspace.students.length === 0) {
      alert('입력된 학생이 없습니다. 각 반 학생 명단을 먼저 입력해주세요.');
      return;
    }

    const uncompletedClasses = [];
    for (let c = 1; c <= workspace.currentClassCount; c++) {
      if (!workspace.classStatus?.[c]?.completed) {
        uncompletedClasses.push(`${c}반`);
      }
    }

    if (uncompletedClasses.length > 0) {
      const confirmContinue = window.confirm(
        `⚠️ 아직 [${uncompletedClasses.join(', ')}]이 '입력 완료'로 표시되지 않았습니다.\n\n그래도 현재까지 입력된 ${workspace.students.length}명의 학생으로 배정을 진행하시겠습니까?`
      );
      if (!confirmContinue) return;
    }

    setLoading(true);
    try {
      const settings: ClassSettings = {
        currentClassCount: workspace.currentClassCount,
        nextClassCount: workspace.nextClassCount,
        normalCapacity: Math.ceil(workspace.students.length / workspace.nextClassCount),
        reductionCount: workspace.reductionCount,
        placementOrder: workspace.placementOrder
      };

      const placementResult = runPlacementAlgorithm(workspace.students, settings);

      await executeWorkspacePlacement(workspace.code, placementResult, settings);
      alert('🎉 학급편성이 성공적으로 완료되었습니다! 동학년 모든 선생님 화면에 결과가 실시간 반영되었습니다.');
    } catch (err: any) {
      alert('배정 실행 중 오류가 발생했습니다: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  };

  // 👑 관리자 전용: 재배정 모드로 초기화
  const handleResetPlacement = async () => {
    if (!workspace || !isHost) return;
    if (window.confirm('정말 배정 결과를 초기화하고 학생 입력 단계로 되돌리시겠습니까?')) {
      await resetWorkspaceToInput(workspace.code);
    }
  };

  // 맞교환(Swap) 처리
  const handleSwapStudents = async (s1: Student, s2: Student) => {
    if (!workspace?.result) return;
    if (!isHost) {
      alert('배정 결과 수정 및 학생 맞교환은 학년부장(관리자) 권한이 필요합니다.');
      return;
    }

    const c1 = s1.배정학급;
    const c2 = s2.배정학급;
    if (!c1 || !c2 || c1 === c2) return;

    const newAssignments = { ...workspace.result.assignments };
    newAssignments[c1] = newAssignments[c1].map(st => st.id === s1.id ? { ...st, 배정학급: c2 } : st);
    newAssignments[c2] = newAssignments[c2].map(st => st.id === s2.id ? { ...st, 배정학급: c1 } : st);

    const updatedResult: PlacementResult = {
      ...workspace.result,
      assignments: newAssignments
    };

    await updateWorkspaceResult(workspace.code, updatedResult);
    setSwapCandidate(null);
  };

  // 학생 직접 반 변경
  const handleManualMove = async (student: Student, targetClass: string) => {
    if (!workspace?.result) return;
    if (!isHost) {
      alert('배정 결과 수정은 학년부장(관리자) 권한이 필요합니다.');
      return;
    }

    const oldClass = student.배정학급;
    if (!oldClass || oldClass === targetClass) return;

    const newAssignments = { ...workspace.result.assignments };
    newAssignments[oldClass] = newAssignments[oldClass].filter(st => st.id !== student.id);
    const movedStudent = { ...student, 배정학급: targetClass };
    newAssignments[targetClass] = [...(newAssignments[targetClass] || []), movedStudent];

    const updatedResult: PlacementResult = {
      ...workspace.result,
      assignments: newAssignments
    };

    await updateWorkspaceResult(workspace.code, updatedResult);
  };

  // VIEW 1: 미입장 상태
  const recoveryDialog = recoveryDisplay && recoveryDisplay.roomCode === currentCode && isHost && membership?.active ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="recovery-code-title">
      <div className="w-full max-w-lg rounded-2xl border border-blue-100 bg-white p-6">
        <h3 id="recovery-code-title" className="flex items-center gap-2 text-lg font-bold text-[#071747]"><Key size={20} className="text-blue-600" /> 관리자 복구 코드</h3>
        <p className="mt-2 text-sm text-slate-600">[{recoveryDisplay.roomCode}] 다른 PC/브라우저에서 관리자 권한 복구에 필요합니다.</p>
        <code className="mt-4 block break-all select-all rounded-xl border border-blue-200 bg-blue-50 p-4 text-base font-semibold text-[#172b4d]">{recoveryDisplay.recoveryCode}</code>
        <p className="mt-3 text-xs leading-relaxed text-amber-800">다시 확인할 수 없으니 안전하게 보관하세요. 타인에게 공유하지 마세요. 이 코드를 가진 사람은 관리자가 될 수 있습니다. 이전에 사용하던 복구 코드는 폐기되었습니다.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(recoveryDisplay.recoveryCode); setRecoveryCopied(true); }
            catch { alert('자동 복사가 되지 않았습니다. 위 코드를 직접 선택해 복사해주세요.'); }
          }} className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white"><Copy size={15} /> {recoveryCopied ? '복사됨' : '복구 코드 복사'}</button>
          <button type="button" onClick={() => { setRecoveryDisplay(null); setRecoveryCopied(false); }} className="rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-slate-600">안전하게 보관했습니다</button>
        </div>
      </div>
    </div>
  ) : null;

  if (!workspace) {
    return (
      <div className="max-w-6xl mx-auto py-1">
        {recoveryDialog}
        <div className="flex flex-wrap items-start justify-between gap-4 py-1 mb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <Users size={13} /> 실시간 동학년 협업
              </span>
              <span className="text-slate-400 text-xs font-normal tracking-normal">Cloud Realtime Sync</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#071747] mt-2">
              동학년 선생님들과 실시간으로 함께하는 학급편성
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              각 반 담임선생님이 자기 반 데이터를 입력하면 실시간으로 자동 취합되고, 학년부장님이 공정하게 배정합니다.
            </p>
          </div>
          {onBackToStandalone && (
            <button
              onClick={onBackToStandalone}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1 shrink-0"
            >
              <ArrowLeft size={14} /> 단독 모드로 전환
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-sm flex flex-wrap items-center gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {currentCode && !membership?.active && (
          <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-[#172b4d]">
            <p className="font-bold">{pendingRequest ? `${currentCode} · 관리자 승인 대기 중` : `${currentCode} · 참여 확인`}</p>
            <p className="mt-1 text-xs">{pendingRequest ? `${pendingRequest.classNum}반 참여 신청을 보냈습니다. 승인 전에는 학생 데이터를 읽지 않습니다.` : '승인된 계정이 아닙니다. 아래에서 참여를 신청하거나 개설한 브라우저로 재입장해주세요.'}</p>
            <button type="button" className="mt-2 text-xs font-bold text-blue-700" onClick={async () => {
              try { if (pendingRequest) await cancelJoinRequest(currentCode); setCurrentCode(''); setError(null); }
              catch (err: any) { setError(err.message); }
            }}>신청 취소 / 돌아가기</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5 items-start">
          {/* 카드 1: 방 개설 (학년부장) */}
          <div className="bg-white border border-blue-100 rounded-2xl p-5 sm:p-6 flex flex-col">
            <div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 shadow-none shadow-none">
                <Crown size={24} />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-[#071747] mb-2">
                1. 우리 학년 방 개설하기
              </h3>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                학년부장 또는 대표 선생님께서 개설합니다. 이 브라우저의 익명 인증 계정이 관리자로 등록됩니다.
              </p>

              <form onSubmit={handleCreateRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    학교 및 학년 명칭 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="예: 2026 해봄초 5학년"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    방 참여 코드 (영문/숫자) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="예: HAEDB5"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2.5 text-sm font-mono uppercase border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    required
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">동학년 선생님들께 공유할 고유 코드입니다.</span>
                </div>

                

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">현재 학급 수</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={createCurrentClasses}
                      onChange={(e) => setCreateCurrentClasses(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">편성할 학급 수</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={createNextClasses}
                      onChange={(e) => setCreateNextClasses(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || recoveryBusy}
                  className="w-full mt-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-none shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center justify-center gap-2"
                >
                  <Crown size={16} /> {loading ? '개설 중...' : '방 개설하고 관리자로 입장'}
                </button>
              </form>
            </div>
          </div>

          {/* 카드 2: 방 입장 (동학년 담임교사 & 학년부장 재입장) */}
          <div className="bg-white border border-blue-100 rounded-2xl p-5 sm:p-6 flex flex-col">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-none shadow-none">
                  <UserCheck size={24} />
                </div>
                {/* 역할 선택 탭 토글 */}
                <div className="bg-blue-50 p-1 rounded-xl flex gap-1 border border-blue-100">
                  <button
                    type="button"
                    onClick={() => setJoinRole('teacher')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1 ${
                      joinRole === 'teacher' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserCheck size={13} /> 담임교사
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinRole('host')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1 ${
                      joinRole === 'host' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Crown size={13} /> 학년부장 재입장
                  </button>
                </div>
              </div>

              <h3 className="text-xl font-bold tracking-tight text-[#071747] mb-2">
                2. 개설된 학년 방 입장하기
              </h3>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                {joinRole === 'teacher'
                  ? '공유받은 방 코드로 참여를 신청하세요. 관리자 승인 후 학생을 등록할 수 있습니다.'
                  : '기존 기기에서는 바로 재입장하고, 다른 기기에서는 관리자 복구 코드를 입력하세요.'}
              </p>

              <form onSubmit={handleJoinRoom} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    방 참여 코드 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="예: HAEDB5"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2.5 text-sm font-mono uppercase border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    required
                  />
                </div>

                {joinRole === 'teacher' ? (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        담당 학급 선택 <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={myClassNum}
                        onChange={(e) => setMyClassNum(Number(e.target.value))}
                        className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white bg-white"
                      >
                        {Array.from({ length: 20 }, (_, i) => i + 1).map(n => (
                          <option key={n} value={n}>{n}반 담임</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        선생님 성함 / 닉네임 (선택)
                      </label>
                      <input
                        type="text"
                        placeholder="예: 김선생님"
                        value={teacherNameInput}
                        onChange={(e) => setTeacherNameInput(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                      />
                    </div>

                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={loading || recoveryBusy}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-none shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <UserCheck size={16} /> {loading ? '입장 중...' : '내 반으로 입장하기'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-blue-700 bg-blue-50 rounded-xl p-3 leading-relaxed">같은 브라우저에서는 복구 코드를 비워두고 재입장할 수 있습니다. 다른 PC/브라우저에서는 보관한 복구 코드를 입력하세요.</p>

                    <div>
                      <label htmlFor="admin-recovery-input" className="mb-1 block text-xs font-bold text-slate-700">관리자 복구 코드</label>
                      <input id="admin-recovery-input" type="password" value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} autoComplete="off" spellCheck={false} maxLength={128} placeholder="다른 기기에서는 복구 코드를 입력하세요" className="w-full rounded-xl border border-blue-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>

                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={loading || recoveryBusy}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-none shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Crown size={16} /> {loading ? '인증 및 입장 중...' : '👑 학년부장(관리자)으로 재입장'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>

            {localStorage.getItem('classdivide_last_room') && (
              <div className="mt-6 pt-4 border-t border-blue-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    const last = localStorage.getItem('classdivide_last_room');
                    if (last) {
                      setCurrentCode(last);
                    }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-bold cursor-pointer inline-flex items-center gap-1"
                >
                  ⚡ 최근 참여했던 방 [{localStorage.getItem('classdivide_last_room')}] 바로 입장

                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: 방 입장 상태
  const totalStudentsCount = workspace.students?.length || 0;
  const completedClassesCount = Object.values<CollaborationWorkspace['classStatus'][number]>(workspace.classStatus || {}).filter(c => c.completed).length;
  const isAllClassesCompleted = completedClassesCount >= workspace.currentClassCount;

  return (
    <div className="max-w-7xl mx-auto py-1 space-y-4">
      {recoveryDialog}
      {/* 헤더 바 */}
      <div className="bg-white border border-blue-100 rounded-2xl p-5 shadow-none flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xl shadow-none shadow-none">
            {workspace.name.slice(0, 1)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold tracking-tight text-[#071747]">{workspace.name}</h2>
              <span className="font-mono bg-slate-100 text-slate-700 text-xs px-2.5 py-0.5 rounded-lg font-bold border border-blue-100">
                코드: {workspace.code}
              </span>
              <button
                onClick={handleCopyInviteLink}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md cursor-pointer transition"
                title="초대 링크 복사"
              >
                {copiedLink ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                {copiedLink ? '복사됨!' : '초대링크 복사'}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
              <span>현재 {workspace.currentClassCount}개 학급</span>
              <span>•</span>
              <span>편성 예정 {workspace.nextClassCount}개 학급</span>
              <span>•</span>
              <span className="font-semibold text-blue-600">총 취합 {totalStudentsCount}명</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isHost ? (
            <>
              <span className="bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-none">
                <Crown size={14} className="text-blue-600" /> 학년부장 (관리자)
              </span>
              <button
                onClick={handleIssueRecoveryCode}
                disabled={recoveryBusy || loading}
                className="flex items-center gap-1.5 rounded-xl border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <Key size={13} /> {recoveryBusy ? '처리 중...' : '복구 코드 발급/재발급'}
              </button>
              <button
                onClick={handleOpenSettingsModal}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer border border-blue-100"
                title="학급 수 변경, 학년명 수정 및 방 관리"
              >
                <Settings size={13} /> 학년 설정 수정
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowAdminAuthModal(true)}
              className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-none"
              title="현재 계정의 권한 안내를 확인합니다"
            >
              <Crown size={13} className="text-blue-600" /> 계정 권한 안내
            </button>
          )}

          <button
            onClick={handleLeaveRoom}
            className="text-xs font-bold text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-blue-100 hover:border-rose-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1"
          >
            <LogOut size={13} /> 방 나가기
          </button>
        </div>
      </div>

      {isHost && Object.keys(joinRequests).length > 0 && (
        <section className="rounded-2xl border border-blue-100 bg-white p-4">
          <h3 className="font-bold text-[#172b4d] text-sm mb-2">참여 승인 대기 · {Object.keys(joinRequests).length}명</h3>
          <p className="text-xs text-slate-500 mb-3">이름은 본인 확인 수단이 아닙니다. 선생님께 직접 확인한 뒤 담당 반을 승인해주세요.</p>
          {Object.entries<JoinRequest>(joinRequests).map(([uid, request]) => (
            <div key={uid} className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-50 py-2 text-xs">
              <span>{request.teacherName} · {request.classNum}반</span>
              <div className="flex gap-2">
                <button disabled={loading} onClick={() => handleReviewRequest(uid, request, true)} className="rounded-lg bg-blue-600 text-white px-3 py-1.5">승인</button>
                <button disabled={loading} onClick={() => handleReviewRequest(uid, request, false)} className="rounded-lg bg-slate-100 text-slate-600 px-3 py-1.5">거절</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ⚙️ 학년 설정 수정 및 방 삭제 모달 (관리자 전용) */}
      {showSettingsModal && workspace && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-none border border-blue-100 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-blue-100 mb-5">
              <div className="flex flex-wrap items-center gap-2 text-[#172b4d] font-bold text-base">
                <Settings size={18} className="text-blue-600" />
                <span>학년 설정 수정 & 방 관리</span>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              >
                닫기
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">학교 및 학년 명칭</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">현재 학급 수</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={editCurrentClasses}
                    onChange={(e) => setEditCurrentClasses(Number(e.target.value))}
                    className="w-full px-3.5 py-2 text-xs border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">변경 시 탭 개수가 즉시 갱신됩니다.</span>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">편성할 학급 수 (새 학급)</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={editNextClasses}
                    onChange={(e) => setEditNextClasses(Number(e.target.value))}
                    className="w-full px-3.5 py-2 text-xs border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">새 학년 배정 반 수</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">통합(특수)학급 정원 감축 수</label>
                <select
                  value={editReduction}
                  onChange={(e) => setEditReduction(Number(e.target.value))}
                  className="w-full px-3.5 py-2 text-xs border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white bg-white"
                >
                  <option value={1}>특수학생 1인당 1명 감축 (-1)</option>
                  <option value={2}>특수학생 1인당 2명 감축 (-2, 기본)</option>
                  <option value={0}>정원 감축 없음 (0명)</option>
                </select>
              </div>

              

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="flex-1 py-2.5 font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer shadow-none"
                >
                  {loading ? '저장 중...' : '⚙️ 변경사항 저장'}
                </button>
              </div>
            </form>

            {/* 위험 구역: 방 영구 삭제 */}
            <div className="mt-5 pt-5 border-t border-rose-100 bg-rose-50/40 -mx-6 -mb-4 p-6 rounded-b-2xl">
              <div className="flex items-center gap-1.5 text-rose-700 font-bold text-xs mb-1">
                <AlertOctagon size={16} />
                <span>위험 구역: 협업 방 영구 삭제</span>
              </div>
              <p className="text-[11px] text-rose-600 mb-3 leading-relaxed">
                모든 배정 작업이 끝나 더 이상 방이 필요 없거나 잘못 개설된 경우 방을 완전히 삭제합니다.
              </p>

              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 bg-white text-rose-600 hover:bg-rose-600 hover:text-white border border-rose-300 rounded-xl text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1.5 shadow-none"
                >
                  <Trash2 size={13} /> 방 영구 삭제하기
                </button>
              ) : (
                <div className="space-y-3 bg-white p-4 rounded-2xl border border-rose-200">
                  <span className="text-xs font-bold text-rose-800 block">
                    정말 삭제하시겠습니까? 확인을 위해 현재 방 코드를 입력해주세요:
                  </span>
                  <input
                    type="text"
                    placeholder="현재 방 코드 입력"
                    value={deleteCodeInput}
                    onChange={(e) => setDeleteCodeInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-rose-300 rounded-xl focus:ring-2 focus:ring-rose-500 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowDeleteConfirm(false); setDeleteCodeInput(''); }}
                      className="flex-1 py-1.5 text-xs font-bold text-slate-500 bg-slate-100 rounded-xl cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteRoom}
                      disabled={loading || !deleteCodeInput.trim()}
                      className="flex-1 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer shadow-none"
                    >
                      {loading ? '삭제 중...' : '확인, 방 완전히 삭제'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 관리자 인증 모달 */}
      {showAdminAuthModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-none border border-blue-100">
            <div className="flex flex-wrap items-center gap-2 text-amber-600 mb-2">
              <Crown size={20} />
              <h3 className="font-bold text-[#172b4d] text-base">계정 권한 안내</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              관리자 권한은 서버에 등록된 계정에 연결됩니다. 다른 기기에서는 관리자 복구 코드가 필요합니다. 일반 참여자의 직접 권한 변경은 허용되지 않습니다.
            </p>
            
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdminAuthModal(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={handleAdminAuth}
                className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer shadow-none"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: 배정 결과 화면 (모든 선생님 동시 열람) */}
      {workspace.step === 3 && workspace.result ? (
        <div className="space-y-4">
          <div className="bg-emerald-50 text-[#172b4d] border border-emerald-100 rounded-2xl p-5 shadow-none flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 size={20} />
                <span className="text-xs font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                  배정 완료 (실시간 동시 공유 중)
                </span>
              </div>
              <h3 className="text-2xl font-bold mt-1">학급편성이 완료되었습니다! 🎉</h3>
              <p className="text-emerald-700 text-xs mt-1">
                동학년 모든 선생님 화면에 동일한 배정 결과와 특이사항 매트릭스가 실시간으로 표시되고 있습니다.
              </p>
            </div>

            {isHost && (
              <button
                onClick={handleResetPlacement}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer shadow-none"
                title="관리자 전용: 배정 취소 및 재입력 모드로 복귀"
              >
                🔄 배정 초기화 및 재입력 모드로
              </button>
            )}
          </div>

          <PlacementResultDashboard
            result={workspace.result}
            allStudents={workspace.students}
            reductionCount={workspace.reductionCount}
            onUpdateResult={isHost ? (up) => {
              void updateWorkspaceResult(workspace.code, up).catch(err => alert('결과 저장 실패: ' + err.message));
            } : undefined}
            onReset={isHost ? handleResetPlacement : undefined}
            isReadOnly={!isHost}
          />
        </div>
      ) : (
        /* STEP 1 & 2: 학생 입력 및 취합 단계 */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 pb-3">
            <button
              onClick={() => setActiveClassTab(0)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex flex-wrap items-center gap-2 ${
                activeClassTab === 0
                  ? 'bg-blue-600 text-white shadow-none shadow-none'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-blue-100'
              }`}
            >
              <Layers size={15} /> ⭐ 전체 취합 현황판
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeClassTab === 0 ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {totalStudentsCount}명
              </span>
            </button>

            {Array.from({ length: workspace.currentClassCount }, (_, i) => i + 1).map((classNum) => {
              const count = (workspace.students || []).filter(s => s.현학급 === classNum).length;
              const isCompleted = workspace.classStatus?.[classNum]?.completed;
              const isCurrent = activeClassTab === classNum;

              return (
                <button
                  key={classNum}
                  onClick={() => setActiveClassTab(classNum)}
                  className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex flex-wrap items-center gap-2 ${
                    isCurrent
                      ? 'bg-slate-900 text-white shadow-none'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-blue-100'
                  }`}
                >
                  <span>{classNum}반</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                    isCurrent ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {count}명
                  </span>
                  {isCompleted && (
                    <CheckCircle2 size={13} className={isCurrent ? 'text-emerald-300' : 'text-emerald-600'} />
                  )}
                </button>
              );
            })}
          </div>

          {activeClassTab === 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: workspace.currentClassCount }, (_, i) => i + 1).map((classNum) => {
                  const classStudents = (workspace.students || []).filter(s => s.현학급 === classNum);
                  const isCompleted = workspace.classStatus?.[classNum]?.completed;
                  const teacher = workspace.classStatus?.[classNum]?.teacherName || `${classNum}반 담임`;
                  const maleCount = classStudents.filter(s => s.성별 === '남성').length;
                  const femaleCount = classStudents.filter(s => s.성별 === '여성').length;
                  const integratedCount = classStudents.filter(s => s.통합학급).length;
                  const guidanceHigh = classStudents.filter(s => s.생활지도 === '상').length;

                  return (
                    <div
                      key={classNum}
                      onClick={() => setActiveClassTab(classNum)}
                      className={`bg-white border rounded-2xl p-5 shadow-none transition shadow-none cursor-pointer relative overflow-hidden ${
                        isCompleted ? 'border-emerald-200 hover:border-emerald-300' : 'border-blue-100 hover:border-blue-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-[#172b4d] text-sm">
                            {classNum}
                          </span>
                          <span className="text-xs font-bold text-slate-700">{teacher}</span>
                        </div>
                        {isCompleted ? (
                          <span className="bg-emerald-50 text-emerald-700 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} /> 입력완료
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            <Clock size={12} /> 작성중
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="text-3xl font-bold text-[#172b4d]">{classStudents.length}</span>
                        <span className="text-xs text-slate-500">명 등록됨</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 bg-slate-50 rounded-xl p-2.5">
                        <div>남 {maleCount} / 여 {femaleCount}</div>
                        <div>특수: {integratedCount}명</div>
                        <div>생활(상): {guidanceHigh}명</div>
                        <div className="text-blue-600 font-bold">클릭하여 편집 ➔</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white border border-blue-100 rounded-2xl p-5 sm:p-6 shadow-none">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full">
                        취합 진행도: {completedClassesCount} / {workspace.currentClassCount} 학급 완료
                      </span>
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-[#071747] mt-2">
                      {isAllClassesCompleted
                        ? '✨ 모든 반의 입력이 완료되었습니다! 배정을 실행할 수 있습니다.'
                        : `⏳ 현재 ${workspace.currentClassCount - completedClassesCount}개 학급이 학생 명단을 입력 중입니다.`}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      총 {totalStudentsCount}명의 학생이 취합되었으며, 배정 버튼을 누르면 모든 선생님 화면에 결과가 실시간으로 나타납니다.
                    </p>
                  </div>

                  <div>
                    {isHost ? (
                      <button
                        onClick={handleRunCollabPlacement}
                        disabled={loading || totalStudentsCount === 0}
                        className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold text-base rounded-2xl shadow-none shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex flex-wrap items-center gap-2"
                      >
                        <Crown size={20} />
                        {loading ? '배정 계산 중...' : '👑 학급편성 최종 실행 (관리자)'}
                      </button>
                    ) : (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex flex-wrap items-center gap-2.5 max-w-md">
                        <Lock size={16} className="shrink-0 text-amber-600" />
                        <div>
                          <span className="font-bold block">학년부장(관리자) 실행 대기 중</span>
                          모든 반 입력이 완료되면 학년부장 선생님께서 최종 학급편성을 실행합니다.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-blue-100 rounded-2xl p-6 shadow-none flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold text-base">
                      {activeClassTab}
                    </span>
                    <h3 className="text-lg font-bold text-[#172b4d]">
                      {activeClassTab}반 학생 명단 관리
                    </h3>
                    {workspace.classStatus?.[activeClassTab]?.completed ? (
                      <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-emerald-100">
                        <CheckCircle2 size={13} /> 입력 완료됨
                      </span>
                    ) : (
                      <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-amber-100">
                        <Clock size={13} /> 작성 중
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    현재 {activeClassTab}반에 {currentTabStudents.length}명의 학생이 등록되어 있습니다.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="file"
                    ref={fileInputRef}
                    disabled={!canEditClass || loading}
                    onChange={handleClassExcelUpload}
                    accept=".xlsx, .xls"
                    className="hidden"
                  />
                  <button
                    disabled={!canEditClass || loading}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1.5 shadow-none"
                  >
                    <Upload size={14} /> {activeClassTab}반 엑셀 업로드
                  </button>
                  <button
                    disabled={!canEditClass || loading}
                    onClick={() => setShowAddStudentModal(true)}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1.5 shadow-none"
                  >
                    <Plus size={14} /> 학생 1명 추가
                  </button>
                  <button
                    disabled={!canEditClass || loading}
                    onClick={handleToggleClassComplete}
                    className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer flex items-center gap-1.5 ${
                      workspace.classStatus?.[activeClassTab]?.completed
                        ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-100'
                        : 'bg-emerald-500 hover:bg-blue-600 text-white'
                    }`}
                  >
                    <CheckCircle2 size={14} />
                    {workspace.classStatus?.[activeClassTab]?.completed
                      ? '완료 상태 취소 (작성중으로)'
                      : '✅ 우리 반 입력 완료로 표시'}
                  </button>
                </div>
              </div>

              {currentTabStudents.length === 0 ? (
                <div className="bg-white border border-blue-100 rounded-2xl p-6 sm:p-8 text-center">
                  <FileSpreadsheet size={48} className="mx-auto text-slate-300 mb-4" />
                  <h4 className="text-base font-bold text-slate-700 mb-1">
                    아직 {activeClassTab}반에 등록된 학생이 없습니다.
                  </h4>
                  <p className="text-xs text-slate-500 mb-4">
                    담임선생님께서는 [엑셀 업로드] 버튼을 눌러 기존 반 학생 명단을 올리시거나 직접 추가해 주세요.
                  </p>
                  <div className="flex justify-center gap-3">
                    <button
                      disabled={!canEditClass || loading}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                    >
                      엑셀 파일 선택
                    </button>
                    <button
                      onClick={generateTemplate}
                      className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl cursor-pointer"
                    >
                      엑셀 서식 다운로드
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-blue-100 rounded-2xl overflow-hidden shadow-none">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-blue-50 border-b border-blue-100 text-[#172b4d] font-semibold">
                        <tr>
                          <th className="py-2.5 px-3 text-center w-12">번호</th>
                          <th className="py-2.5 px-3">이름</th>
                          <th className="py-2.5 px-3 text-center">성별</th>
                          <th className="py-2.5 px-3 text-center">생활지도</th>
                          <th className="py-2.5 px-3 text-center">학습부진</th>
                          <th className="py-2.5 px-3 text-center">운동부</th>
                          <th className="py-2.5 px-3 text-center">특수(통합)</th>
                          <th className="py-2.5 px-3 text-center">쌍둥이</th>
                          <th className="py-2.5 px-3 text-center">분리배정</th>
                          <th className="py-2.5 px-3 text-center">전출예정</th>
                          <th className="py-2.5 px-3 text-center w-16">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {currentTabStudents.map((st, idx) => (
                          <tr key={st.id} className="hover:bg-blue-50/60 transition">
                            <td className="py-2.5 px-3 text-center font-mono text-slate-400">{st.번호 || idx + 1}</td>
                            <td className="py-2.5 px-3 font-bold text-[#172b4d]">{st.이름}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                st.성별 === '남성' ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'
                              }`}>
                                {st.성별}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {st.생활지도 ? (
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  st.생활지도 === '상' ? 'bg-rose-100 text-rose-700' :
                                  st.생활지도 === '중' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {st.생활지도}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-center">{st.학습부진 ? '🚩' : '-'}</td>
                            <td className="py-2.5 px-3 text-center">{st.학생선수 ? '🏃' : '-'}</td>
                            <td className="py-2.5 px-3 text-center">{st.통합학급 ? '🌿' : '-'}</td>
                            <td className="py-2.5 px-3 text-center">{st.쌍둥이 ? '👥' : '-'}</td>
                            <td className="py-2.5 px-3 text-center font-mono text-[11px]">{st.분리배정 || '-'}</td>
                            <td className="py-2.5 px-3 text-center">{st.전출예정 ? '✈️' : '-'}</td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                disabled={!canEditClass || loading}
                      onClick={() => handleDeleteStudent(st.id)}
                                className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer"
                                title="학생 삭제"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {showAddStudentModal && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-none border border-blue-100 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-[#172b4d] text-base">
                    {activeClassTab}반 학생 1명 추가
                  </h3>
                  <button
                    onClick={() => setShowAddStudentModal(false)}
                    className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    닫기
                  </button>
                </div>

                <form onSubmit={handleAddStudentSubmit} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">성명 *</label>
                    <input
                      type="text"
                      value={newStudent.이름 || ''}
                      onChange={(e) => setNewStudent({ ...newStudent, 이름: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                      required
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">성별</label>
                      <select
                        value={newStudent.성별}
                        onChange={(e) => setNewStudent({ ...newStudent, 성별: e.target.value as any })}
                        className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="남성">남성</option>
                        <option value="여성">여성</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">생활지도 수준</label>
                      <select
                        value={newStudent.생활지도}
                        onChange={(e) => setNewStudent({ ...newStudent, 생활지도: e.target.value as any })}
                        className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="">해당없음</option>
                        <option value="상">상 (중점 지도)</option>
                        <option value="중">중</option>
                        <option value="하">하</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-blue-100">
                    <span className="font-bold text-slate-700 block">특이사항 체크</span>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.통합학급}
                          onChange={(e) => setNewStudent({ ...newStudent, 통합학급: e.target.checked })}
                        />
                        <span>🌿 특수(통합)학급</span>
                      </label>
                      <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.학습부진}
                          onChange={(e) => setNewStudent({ ...newStudent, 학습부진: e.target.checked })}
                        />
                        <span>🚩 기초학력 지원</span>
                      </label>
                      <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.학생선수}
                          onChange={(e) => setNewStudent({ ...newStudent, 학생선수: e.target.checked })}
                        />
                        <span>🏃 운동부(학생선수)</span>
                      </label>
                      <label className="flex flex-wrap items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.쌍둥이}
                          onChange={(e) => setNewStudent({ ...newStudent, 쌍둥이: e.target.checked })}
                        />
                        <span>👥 쌍둥이</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">분리배정 요청 (선택)</label>
                    <input
                      type="text"
                      placeholder="예: 5-2 김철수와 분리"
                      value={newStudent.분리배정 || ''}
                      onChange={(e) => setNewStudent({ ...newStudent, 분리배정: e.target.value })}
                      className="w-full px-3 py-2 border border-blue-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-blue-100">
                    <button
                      type="button"
                      onClick={() => setShowAddStudentModal(false)}
                      className="flex-1 py-2 font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer shadow-none"
                    >
                      학생 추가하기
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
