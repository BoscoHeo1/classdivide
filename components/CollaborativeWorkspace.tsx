import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, ShieldCheck, Crown, UserCheck, Key, LogOut, CheckCircle2, 
  Clock, Upload, Plus, Trash2, ArrowRight, ArrowLeft, RefreshCw, 
  Layers, Sparkles, Copy, Check, Download, AlertTriangle, FileSpreadsheet, Lock
} from 'lucide-react';
import { GradeWorkspace, Student, ClassSettings, PlacementResult } from '../types';
import { 
  createWorkspace, getWorkspace, subscribeWorkspace, updateClassStudents, 
  executeWorkspacePlacement, updateWorkspaceResult, resetWorkspaceToInput 
} from '../firebase';
import { parseExcel, generateTemplate, downloadResultsByNewClass, downloadResultsByOldClass } from '../utils/excel';
import { runPlacementAlgorithm } from '../utils/algorithm';
import ClassTable from './ClassTable';
import { PlacementResultDashboard } from './PlacementResultDashboard';

interface CollaborativeWorkspaceProps {
  onBackToStandalone?: () => void;
}

export const CollaborativeWorkspace: React.FC<CollaborativeWorkspaceProps> = ({ onBackToStandalone }) => {
  // 세션 로컬 식별자 (브라우저 고유값)
  const [localUserId] = useState<string>(() => {
    let id = localStorage.getItem('classdivide_local_uid');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('classdivide_local_uid', id);
    }
    return id;
  });

  // 1. 방 접속 및 상태
  const [currentCode, setCurrentCode] = useState<string>(() => localStorage.getItem('classdivide_last_room') || '');
  const [workspace, setWorkspace] = useState<GradeWorkspace | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // 2. 권한 상태
  const [isHost, setIsHost] = useState<boolean>(false);
  const [showAdminAuthModal, setShowAdminAuthModal] = useState<boolean>(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState<string>('');

  // 3. 방 개설 폼
  const [createName, setCreateName] = useState<string>('');
  const [createCode, setCreateCode] = useState<string>('');
  const [createPassword, setCreatePassword] = useState<string>('');
  const [createCurrentClasses, setCreateCurrentClasses] = useState<number>(6);
  const [createNextClasses, setCreateNextClasses] = useState<number>(6);

  // 4. 방 입장 폼
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [myClassNum, setMyClassNum] = useState<number>(1);
  const [teacherNameInput, setTeacherNameInput] = useState<string>('');
  const [joinRole, setJoinRole] = useState<'teacher' | 'host'>('teacher');
  const [joinAdminPassword, setJoinAdminPassword] = useState<string>('');

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

  // 실시간 동기화 구독
  useEffect(() => {
    if (!currentCode) return;
    setLoading(true);
    const unsubscribe = subscribeWorkspace(currentCode, (updated) => {
      setLoading(false);
      if (updated) {
        setWorkspace(updated);
        localStorage.setItem('classdivide_last_room', currentCode);
        // 호스트 여부 체크
        const hostToken = localStorage.getItem(`classdivide_host_${currentCode}`);
        if (hostToken === 'true' || updated.hostId === localUserId) {
          setIsHost(true);
        }
      } else {
        setWorkspace(null);
        setError('해당 방이 존재하지 않거나 삭제되었습니다.');
      }
    });

    return () => unsubscribe();
  }, [currentCode, localUserId]);

  // URL 파라미터에서 방 코드 자동 감지 (?room=CODE)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && roomParam !== currentCode) {
      setCurrentCode(roomParam.toUpperCase());
    }
  }, []);

  // 링크 복사
  const handleCopyInviteLink = () => {
    if (!workspace) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${workspace.code}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // 방 개설 (호스트)
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createCode.trim() || !createName.trim() || !createPassword.trim()) {
      alert('학교/학년명, 방 코드, 관리 비밀번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const code = await createWorkspace(
        createCode,
        createName,
        createPassword,
        {
          currentClassCount: createCurrentClasses,
          nextClassCount: createNextClasses,
          normalCapacity: 24,
          reductionCount: 2,
          placementOrder: 'zigzag'
        },
        localUserId
      );

      localStorage.setItem(`classdivide_host_${code}`, 'true');
      setIsHost(true);
      setCurrentCode(code);
    } catch (err: any) {
      setError(err.message || '방 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 방 입장 (담임교사 또는 학년부장 재입장)
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) {
      alert('방 코드를 입력해주세요.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getWorkspace(joinCodeInput);
      if (!data) {
        throw new Error(`방 코드 [${joinCodeInput.toUpperCase()}]를 찾을 수 없습니다. 코드를 확인해주세요.`);
      }

      if (joinRole === 'host') {
        if (!joinAdminPassword.trim()) {
          throw new Error('학년부장으로 입장하시려면 개설 시 설정하신 관리 비밀번호를 입력해주세요.');
        }
        if (data.password !== joinAdminPassword.trim()) {
          throw new Error('관리자 비밀번호가 일치하지 않습니다. 비밀번호를 다시 확인해주세요.');
        }
        // 관리자 인증 성공
        setIsHost(true);
        localStorage.setItem(`classdivide_host_${data.code}`, 'true');
        alert('👑 학년부장(관리자) 권한으로 성공적으로 재입장하였습니다!');
      } else {
        // 일반 담임교사 입장
        setIsHost(false);
        setActiveClassTab(myClassNum);
      }

      setCurrentCode(data.code);
    } catch (err: any) {
      setError(err.message || '방 입장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 관리자 인증 (비밀번호 검증)
  const handleAdminAuth = () => {
    if (!workspace) return;
    if (adminPasswordInput.trim() === workspace.password) {
      setIsHost(true);
      localStorage.setItem(`classdivide_host_${workspace.code}`, 'true');
      setShowAdminAuthModal(false);
      setAdminPasswordInput('');
      alert('👑 학년부장(관리자) 인증이 완료되었습니다! 배정 실행 및 모든 제어 권한이 활성화되었습니다.');
    } else {
      alert('비밀번호가 올바르지 않습니다.');
    }
  };

  // 방 나가기
  const handleLeaveRoom = () => {
    if (window.confirm('현재 협업 방에서 나가시겠습니까?')) {
      setCurrentCode('');
      setWorkspace(null);
      localStorage.removeItem('classdivide_last_room');
    }
  };

  // 현재 탭의 반 학생들
  const currentTabStudents = (workspace?.students || []).filter(s => s.현학급 === activeClassTab);

  // 내 반 엑셀 업로드 처리
  const handleClassExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspace) return;

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
    if (!workspace) return;
    const currentCompleted = workspace.classStatus?.[activeClassTab]?.completed || false;
    await updateClassStudents(
      workspace.code,
      activeClassTab,
      currentTabStudents,
      !currentCompleted,
      teacherNameInput
    );
  };

  // 단일 학생 추가
  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !newStudent.이름) return;

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
    await updateClassStudents(workspace.code, activeClassTab, updated, false, teacherNameInput);
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
    if (!workspace || !window.confirm('이 학생을 삭제하시겠습니까?')) return;
    const updated = currentTabStudents.filter(s => s.id !== studentId);
    await updateClassStudents(workspace.code, activeClassTab, updated, false, teacherNameInput);
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

      await executeWorkspacePlacement(workspace.code, workspace.password, placementResult, settings);
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
      await resetWorkspaceToInput(workspace.code, workspace.password);
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
  if (!workspace) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between bg-white border border-slate-200 rounded-3xl p-6 shadow-xs mb-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <Users size={13} /> 실시간 동학년 협업
              </span>
              <span className="text-slate-400 text-xs">Cloud Realtime Sync</span>
            </div>
            <h2 className="text-2xl font-black text-slate-800 mt-2">
              동학년 선생님들과 실시간으로 함께하는 학급편성
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              각 반 담임선생님이 자기 반 데이터를 입력하면 실시간으로 자동 취합되고, 학년부장님이 공정하게 배정합니다.
            </p>
          </div>
          {onBackToStandalone && (
            <button
              onClick={onBackToStandalone}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer flex items-center gap-1 shrink-0"
            >
              <ArrowLeft size={14} /> 단독 모드로 전환
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-sm flex items-center gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* 카드 1: 방 개설 (학년부장) */}
          <div className="bg-white border-2 border-indigo-100 hover:border-indigo-300 rounded-3xl p-8 shadow-xs transition flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mb-6 shadow-md shadow-indigo-100">
                <Crown size={24} />
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">
                1. 우리 학년 방 개설하기
              </h3>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                학년부장 또는 대표 선생님께서 개설합니다. 배정 최종 실행 권한을 제어할 관리 비밀번호를 설정하세요.
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
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                    className="w-full px-4 py-2.5 text-sm font-mono uppercase border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">동학년 선생님들께 공유할 고유 코드입니다.</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    관리자 실행 비밀번호 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="password"
                    placeholder="배정 실행 시 사용할 비밀번호"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    required
                  />
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
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-100 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Crown size={16} /> {loading ? '개설 중...' : '방 개설하고 관리자로 입장'}
                </button>
              </form>
            </div>
          </div>

          {/* 카드 2: 방 입장 (동학년 담임교사 & 학년부장 재입장) */}
          <div className="bg-white border-2 border-emerald-100 hover:border-emerald-300 rounded-3xl p-8 shadow-xs transition flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-100">
                  <UserCheck size={24} />
                </div>
                {/* 역할 선택 탭 토글 */}
                <div className="bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setJoinRole('teacher')}
                    className={`px-3 py-1.5 text-xs font-black rounded-lg transition cursor-pointer flex items-center gap-1 ${
                      joinRole === 'teacher' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserCheck size={13} /> 담임교사
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinRole('host')}
                    className={`px-3 py-1.5 text-xs font-black rounded-lg transition cursor-pointer flex items-center gap-1 ${
                      joinRole === 'host' ? 'bg-amber-500 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Crown size={13} /> 학년부장 재입장
                  </button>
                </div>
              </div>

              <h3 className="text-xl font-black text-slate-800 mb-2">
                2. 개설된 학년 방 입장하기
              </h3>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                {joinRole === 'teacher'
                  ? '공유받은 방 코드를 입력하고 내 반 탭에 접속하여 학생을 등록하세요.'
                  : '방을 나갔던 학년부장 선생님께서는 관리 비밀번호를 입력하고 관리자 권한으로 재입장하세요.'}
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
                    className="w-full px-4 py-2.5 text-sm font-mono uppercase border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
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
                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
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
                        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-100 transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <UserCheck size={16} /> {loading ? '입장 중...' : '내 반으로 입장하기'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        👑 관리자 비밀번호 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="password"
                        placeholder="방 개설 시 설정했던 비밀번호 입력"
                        value={joinAdminPassword}
                        onChange={(e) => setJoinAdminPassword(e.target.value)}
                        className="w-full px-4 py-2.5 text-sm border border-amber-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none bg-amber-50/20"
                        required
                        autoFocus
                      />
                      <span className="text-[11px] text-amber-700 mt-1 block">
                        비밀번호가 일치하면 즉시 학년부장(관리자) 권한이 복원되어 배정 실행이 가능합니다.
                      </span>
                    </div>

                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl shadow-lg shadow-amber-100 transition cursor-pointer flex items-center justify-center gap-2"
                      >
                        <Crown size={16} /> {loading ? '인증 및 입장 중...' : '👑 학년부장(관리자)으로 재입장'}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>

            {localStorage.getItem('classdivide_last_room') && (
              <div className="mt-6 pt-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => {
                    const last = localStorage.getItem('classdivide_last_room');
                    if (last) {
                      const wasHost = localStorage.getItem(`classdivide_host_${last}`) === 'true';
                      setIsHost(wasHost);
                      setCurrentCode(last);
                    }
                  }}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer inline-flex items-center gap-1"
                >
                  ⚡ 최근 참여했던 방 [{localStorage.getItem('classdivide_last_room')}] 바로 입장
                  {localStorage.getItem(`classdivide_host_${localStorage.getItem('classdivide_last_room')}`) === 'true' && (
                    <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded font-black">
                      👑 관리자 복원
                    </span>
                  )}
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
  const completedClassesCount = Object.values(workspace.classStatus || {}).filter(c => c.completed).length;
  const isAllClassesCompleted = completedClassesCount >= workspace.currentClassCount;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* 헤더 바 */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shadow-md shadow-indigo-100">
            {workspace.name.slice(0, 1)}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-black text-slate-800">{workspace.name}</h2>
              <span className="font-mono bg-slate-100 text-slate-700 text-xs px-2.5 py-0.5 rounded-lg font-bold border border-slate-200">
                코드: {workspace.code}
              </span>
              <button
                onClick={handleCopyInviteLink}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-md cursor-pointer transition"
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
              <span className="font-semibold text-indigo-600">총 취합 {totalStudentsCount}명</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isHost ? (
            <span className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-2xs">
              <Crown size={14} className="text-amber-500" /> 학년부장 (관리자 권한)
            </span>
          ) : (
            <button
              onClick={() => setShowAdminAuthModal(true)}
              className="bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-black px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 cursor-pointer transition shadow-2xs"
              title="관리 비밀번호를 입력하여 학년부장 실행 권한을 획득합니다"
            >
              <Crown size={13} className="text-amber-600" /> 👑 학년부장(관리자) 권한 인증
            </button>
          )}

          <button
            onClick={handleLeaveRoom}
            className="text-xs font-bold text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-rose-200 transition cursor-pointer flex items-center gap-1"
          >
            <LogOut size={13} /> 방 나가기
          </button>
        </div>
      </div>

      {/* 관리자 인증 모달 */}
      {showAdminAuthModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <Crown size={20} />
              <h3 className="font-black text-slate-800 text-base">학년부장(관리자) 인증</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              방 개설 시 설정하신 관리 비밀번호를 입력하시면 배정 최종 실행 권한을 획득하실 수 있습니다.
            </p>
            <input
              type="password"
              placeholder="관리자 비밀번호"
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdminAuthModal(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={handleAdminAuth}
                className="flex-1 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl cursor-pointer shadow-xs"
              >
                인증하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: 배정 결과 화면 (모든 선생님 동시 열람) */}
      {workspace.step === 3 && workspace.result ? (
        <div className="space-y-6">
          <div className="bg-emerald-500 text-white rounded-3xl p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} />
                <span className="text-xs font-black tracking-wider uppercase bg-white/20 px-2 py-0.5 rounded-full">
                  배정 완료 (실시간 동시 공유 중)
                </span>
              </div>
              <h3 className="text-2xl font-black mt-1">학급편성이 완료되었습니다! 🎉</h3>
              <p className="text-emerald-50 text-xs mt-1">
                동학년 모든 선생님 화면에 동일한 배정 결과와 특이사항 매트릭스가 실시간으로 표시되고 있습니다.
              </p>
            </div>

            {isHost && (
              <button
                onClick={handleResetPlacement}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs"
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
            onUpdateResult={isHost ? (up) => updateWorkspaceResult(workspace.code, up) : undefined}
            onReset={isHost ? handleResetPlacement : undefined}
            isReadOnly={!isHost}
          />
        </div>
      ) : (
        /* STEP 1 & 2: 학생 입력 및 취합 단계 */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
            <button
              onClick={() => setActiveClassTab(0)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-black transition cursor-pointer flex items-center gap-2 ${
                activeClassTab === 0
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Layers size={15} /> ⭐ 전체 취합 현황판
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeClassTab === 0 ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
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
                  className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
                    isCurrent
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
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
            <div className="space-y-6">
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
                      className={`bg-white border rounded-3xl p-5 shadow-xs transition hover:shadow-md cursor-pointer relative overflow-hidden ${
                        isCompleted ? 'border-emerald-200 hover:border-emerald-300' : 'border-slate-200 hover:border-indigo-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-800 text-sm">
                            {classNum}
                          </span>
                          <span className="text-xs font-bold text-slate-700">{teacher}</span>
                        </div>
                        {isCompleted ? (
                          <span className="bg-emerald-50 text-emerald-700 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={12} /> 입력완료
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                            <Clock size={12} /> 작성중
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="text-3xl font-black text-slate-800">{classStudents.length}</span>
                        <span className="text-xs text-slate-500">명 등록됨</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-600 bg-slate-50 rounded-xl p-2.5">
                        <div>남 {maleCount} / 여 {femaleCount}</div>
                        <div>특수: {integratedCount}명</div>
                        <div>생활(상): {guidanceHigh}명</div>
                        <div className="text-indigo-600 font-bold">클릭하여 편집 ➔</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="bg-white border-2 border-indigo-100 rounded-3xl p-8 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
                        취합 진행도: {completedClassesCount} / {workspace.currentClassCount} 학급 완료
                      </span>
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mt-2">
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
                        className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-black text-base rounded-2xl shadow-xl shadow-indigo-100 transition cursor-pointer flex items-center gap-2"
                      >
                        <Crown size={20} />
                        {loading ? '배정 계산 중...' : '👑 학급편성 최종 실행 (관리자)'}
                      </button>
                    ) : (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 flex items-center gap-2.5 max-w-md">
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
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-base">
                      {activeClassTab}
                    </span>
                    <h3 className="text-lg font-black text-slate-800">
                      {activeClassTab}반 학생 명단 관리
                    </h3>
                    {workspace.classStatus?.[activeClassTab]?.completed ? (
                      <span className="bg-emerald-50 text-emerald-700 text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1 border border-emerald-100">
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
                    onChange={handleClassExcelUpload}
                    accept=".xlsx, .xls"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    <Upload size={14} /> {activeClassTab}반 엑셀 업로드
                  </button>
                  <button
                    onClick={() => setShowAddStudentModal(true)}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                  >
                    <Plus size={14} /> 학생 1명 추가
                  </button>
                  <button
                    onClick={handleToggleClassComplete}
                    className={`px-4 py-2.5 text-xs font-black rounded-xl transition cursor-pointer flex items-center gap-1.5 ${
                      workspace.classStatus?.[activeClassTab]?.completed
                        ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                        : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-xs'
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
                <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center">
                  <FileSpreadsheet size={48} className="mx-auto text-slate-300 mb-4" />
                  <h4 className="text-base font-black text-slate-700 mb-1">
                    아직 {activeClassTab}반에 등록된 학생이 없습니다.
                  </h4>
                  <p className="text-xs text-slate-500 mb-6">
                    담임선생님께서는 [엑셀 업로드] 버튼을 눌러 기존 반 학생 명단을 올리시거나 직접 추가해 주세요.
                  </p>
                  <div className="flex justify-center gap-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer"
                    >
                      엑셀 파일 선택
                    </button>
                    <button
                      onClick={generateTemplate}
                      className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
                    >
                      엑셀 서식 다운로드
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                        <tr>
                          <th className="py-3 px-4 text-center w-12">번호</th>
                          <th className="py-3 px-4">이름</th>
                          <th className="py-3 px-4 text-center">성별</th>
                          <th className="py-3 px-4 text-center">생활지도</th>
                          <th className="py-3 px-4 text-center">학습부진</th>
                          <th className="py-3 px-4 text-center">운동부</th>
                          <th className="py-3 px-4 text-center">특수(통합)</th>
                          <th className="py-3 px-4 text-center">쌍둥이</th>
                          <th className="py-3 px-4 text-center">분리배정</th>
                          <th className="py-3 px-4 text-center">전출예정</th>
                          <th className="py-3 px-4 text-center w-16">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700">
                        {currentTabStudents.map((st, idx) => (
                          <tr key={st.id} className="hover:bg-slate-50/70 transition">
                            <td className="py-3 px-4 text-center font-mono text-slate-400">{st.번호 || idx + 1}</td>
                            <td className="py-3 px-4 font-bold text-slate-800">{st.이름}</td>
                            <td className="py-3 px-4 text-center">
                              <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                st.성별 === '남성' ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'
                              }`}>
                                {st.성별}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {st.생활지도 ? (
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  st.생활지도 === '상' ? 'bg-rose-100 text-rose-700' :
                                  st.생활지도 === '중' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {st.생활지도}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="py-3 px-4 text-center">{st.학습부진 ? '🚩' : '-'}</td>
                            <td className="py-3 px-4 text-center">{st.학생선수 ? '🏃' : '-'}</td>
                            <td className="py-3 px-4 text-center">{st.통합학급 ? '🌿' : '-'}</td>
                            <td className="py-3 px-4 text-center">{st.쌍둥이 ? '👥' : '-'}</td>
                            <td className="py-3 px-4 text-center font-mono text-[11px]">{st.분리배정 || '-'}</td>
                            <td className="py-3 px-4 text-center">{st.전출예정 ? '✈️' : '-'}</td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => handleDeleteStudent(st.id)}
                                className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
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
              <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-black text-slate-800 text-base">
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
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                      >
                        <option value="">해당없음</option>
                        <option value="상">상 (중점 지도)</option>
                        <option value="중">중</option>
                        <option value="하">하</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <span className="font-bold text-slate-700 block">특이사항 체크</span>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.통합학급}
                          onChange={(e) => setNewStudent({ ...newStudent, 통합학급: e.target.checked })}
                        />
                        <span>🌿 특수(통합)학급</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.학습부진}
                          onChange={(e) => setNewStudent({ ...newStudent, 학습부진: e.target.checked })}
                        />
                        <span>🚩 기초학력 지원</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newStudent.학생선수}
                          onChange={(e) => setNewStudent({ ...newStudent, 학생선수: e.target.checked })}
                        />
                        <span>🏃 운동부(학생선수)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
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
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowAddStudentModal(false)}
                      className="flex-1 py-2 font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl cursor-pointer shadow-xs"
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
