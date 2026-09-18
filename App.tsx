import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Settings, Users, ArrowRight, CheckCircle, AlertTriangle, FileSpreadsheet, RefreshCw, Layers, Sliders, ShieldCheck, BookOpen } from 'lucide-react';
import { Student, ClassSettings, PlacementResult } from './types';
import { parseExcel, generateTemplate, generateSampleData, downloadResultsByNewClass, downloadResultsByOldClass } from './utils/excel';
import { runPlacementAlgorithm } from './utils/algorithm';
import ClassTable from './components/ClassTable';
import { DynamicWizard } from './components/DynamicWizard';
import { CollaborativeWorkspace } from './components/CollaborativeWorkspace';
import { ManualModal } from './components/ManualModal';

const App: React.FC = () => {
  // 최상위 모드: 단독 모드 (기존) vs 동학년 실시간 협업 모드 (신규)
  const [mainMode, setMainMode] = useState<'standalone' | 'collab'>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('room') ? 'collab' : 'standalone';
  });

  // 사용설명서 모달 상태
  const [showManualModal, setShowManualModal] = useState<boolean>(false);

  // State
  const [mode, setMode] = useState<'standard' | 'dynamic'>('standard');
  const [step, setStep] = useState<number>(1);
  const [students, setStudents] = useState<Student[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const [settings, setSettings] = useState<ClassSettings>({
    currentClassCount: 11,
    nextClassCount: 11,
    normalCapacity: 24,
    reductionCount: 2,
    placementOrder: 'zigzag'
  });

  const [result, setResult] = useState<PlacementResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [resultViewMode, setResultViewMode] = useState<'newClass' | 'oldClass'>('newClass');
  const [filterSpecialOnly, setFilterSpecialOnly] = useState<boolean>(false);
  const [swapCandidate, setSwapCandidate] = useState<Student | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    setError(null);
    try {
      const data = await parseExcel(file);
      setStudents(data);
      setFileName(file.name);
      // Auto-set next class count estimation
      const totalStudents = data.length;
      const estClasses = Math.ceil(totalStudents / 25); // rough estimate
      setSettings(prev => ({ ...prev, nextClassCount: estClasses > 0 ? estClasses : 11 }));
    } catch (err: any) {
      setError('파일을 읽는 중 오류가 발생했습니다. 올바른 엑셀 형식인지 확인해주세요.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRunAlgorithm = () => {
    setLoading(true);
    setTimeout(() => { // Give UI a moment to update
        try {
            const res = runPlacementAlgorithm(students, settings);
            setResult(res);
            setActiveTab(res.activeClassNames[0]);
            setStep(3);
        } catch (e) {
            setError('알고리즘 실행 중 오류가 발생했습니다.');
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, 100);
  };

  const handleDownloadNewClass = () => {
      if(result) {
          downloadResultsByNewClass(Object.values(result.assignments).flat() as Student[], result.assignments);
      }
  };

  const handleDownloadOldClass = () => {
    if(result) {
        downloadResultsByOldClass(Object.values(result.assignments).flat() as Student[]);
    }
  };

  // 수동 배정반 변경 핸들러
  const handleStudentClassChange = (studentId: number, newClassName: string) => {
    if (!result) return;
    const allStudents: Student[] = Object.values<Student[]>(result.assignments).flat();
    const target = allStudents.find(s => s.id === studentId);
    if (!target || target.배정학급 === newClassName) return;

    target.배정학급 = newClassName;

    // 새로운 assignments 객체 생성 및 출석번호 가나다순 재부여
    const newAssignments: Record<string, Student[]> = {};
    result.activeClassNames.forEach(name => {
      newAssignments[name] = allStudents
        .filter(s => s.배정학급 === name)
        .sort((a, b) => {
          if (a.전출예정 && !b.전출예정) return 1;
          if (!a.전출예정 && b.전출예정) return -1;
          return a.이름.localeCompare(b.이름, 'ko');
        });
      newAssignments[name].forEach((s, idx) => {
        s.출석번호 = idx + 1;
      });
    });

    setResult({
      ...result,
      assignments: newAssignments
    });
  };

  // 1:1 맞교환(Swap) 핸들러
  const handleSelectSwap = (student: Student) => {
    if (!result) return;

    if (!swapCandidate) {
      setSwapCandidate(student);
    } else {
      if (swapCandidate.id === student.id) {
        setSwapCandidate(null);
        return;
      }

      const class1 = swapCandidate.배정학급;
      const class2 = student.배정학급;

      if (!class1 || !class2) {
        setSwapCandidate(null);
        return;
      }

      if (class1 === class2) {
        alert('서로 다른 반 학생끼리만 맞교환할 수 있습니다.');
        return;
      }

      // 두 학생의 배정학급 맞바꾸기
      const allStudents: Student[] = Object.values<Student[]>(result.assignments).flat();
      const s1 = allStudents.find(s => s.id === swapCandidate.id);
      const s2 = allStudents.find(s => s.id === student.id);

      if (s1 && s2) {
        s1.배정학급 = class2;
        s2.배정학급 = class1;

        const newAssignments: Record<string, Student[]> = {};
        result.activeClassNames.forEach(name => {
          newAssignments[name] = allStudents
            .filter(s => s.배정학급 === name)
            .sort((a, b) => {
              if (a.전출예정 && !b.전출예정) return 1;
              if (!a.전출예정 && b.전출예정) return -1;
              return a.이름.localeCompare(b.이름, 'ko');
            });
          newAssignments[name].forEach((s, idx) => {
            s.출석번호 = idx + 1;
          });
        });

        setResult({
          ...result,
          assignments: newAssignments
        });
      }

      setSwapCandidate(null);
    }
  };

  // Preview Stats
  const maleCount = students.filter(s => s.성별 === '남성').length;
  const femaleCount = students.filter(s => s.성별 === '여성').length;
  const dupCount = students.filter(s => s.동명이인).length;

  // 쌍둥이 그룹 감지
  const twinGroups: { key: string; members: Student[] }[] = [];
  const twinsByDob: Record<string, Student[]> = {};
  students.filter(s => s.쌍둥이).forEach(s => {
    const key = s.생년월일 || `${s.현학급}_쌍둥이_${s.id}`;
    if (!twinsByDob[key]) twinsByDob[key] = [];
    twinsByDob[key].push(s);
  });
  Object.entries(twinsByDob).forEach(([key, members]) => {
    if (members.length > 1) {
      twinGroups.push({ key, members });
    }
  });

  return (
    <div className="min-h-screen bg-[#f8fbff] text-[#172b4d] font-sans pb-12 sm:pb-16">
      
      {/* Header / Global Navbar */}
      <header className="sticky top-0 z-40 min-h-16 bg-white/95 backdrop-blur-sm border-b border-[#dce7f3] px-4 py-3 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5 text-slate-700">
            <BookOpen aria-hidden="true" className="h-5 w-5 shrink-0 text-[#1677ed]" strokeWidth={2} />
            <h1 className="text-base font-bold tracking-tight text-[#071747]">
              보스코쌤 · 반편성 프로그램
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/70 border border-blue-100 rounded-full text-xs text-slate-600">
              <ShieldCheck className="w-3.5 h-3.5 text-[#1677ed] shrink-0" />
              <span>단독: 브라우저 메모리 처리 · 협업: 서버 실시간 동기화</span>
            </div>
            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-full text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer shadow-sm"
            >
              <BookOpen className="w-4 h-4 text-[#1677ed]" />
              <span>📖 교사용 사용설명서</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">

        {/* 🌟 Bosco 스타일 Hero Section */}
        <section aria-labelledby="classdivide-hero-title" className="mb-6 overflow-hidden rounded-3xl border border-blue-100 bg-[#eaf4ff] p-6 sm:p-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/80 border border-blue-200/60 rounded-full text-xs font-semibold text-blue-700 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1677ed]"></span>
              초등 교사용 지능형 학급 편성 솔루션
            </div>
            <h2 id="classdivide-hero-title" className="text-2xl sm:text-3xl lg:text-4xl font-extrabold leading-tight tracking-tight text-[#071747]">
              보스코쌤의 반편성 프로그램
            </h2>
            <p className="mt-2.5 text-sm sm:text-base font-normal leading-relaxed text-[#354c75]">
              복잡한 학생 배정, 이제 클릭 한 번으로 끝내세요.<br className="hidden sm:inline" />
              성별, 성적, 생활지도 등 모든 조건을 고려하여 최적의 학급을 편성합니다.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1677ed]">
                <FileSpreadsheet className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#071747]">단독 모드</p>
                <p className="text-[11px] text-slate-500 truncate">엑셀 업로드로 PC 즉시 배정</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Users className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#071747]">동학년 실시간 협업</p>
                <p className="text-[11px] text-slate-500 truncate">선생님별 분담 입력 및 자동 취합</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                <Layers className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#071747]">다각도 균등 편성</p>
                <p className="text-[11px] text-slate-500 truncate">성별·성적·생활지도 균형 분산</p>
              </div>
            </div>
          </div>
        </section>

        {/* 🌟 최상위 운영 모드 토글: 단독 모드 vs 동학년 실시간 협업 모드 */}
        <div className="w-full max-w-xl mb-6 bg-white p-1.5 rounded-full grid grid-cols-2 gap-1.5 border border-[#dce7f3] shadow-sm">
          <button
            type="button"
            onClick={() => setMainMode('standalone')}
            className={`px-4 py-2.5 text-sm font-semibold rounded-full flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer ${
              mainMode === 'standalone'
                ? 'bg-[#1677ed] text-white shadow-sm'
                : 'text-[#354c75] hover:text-[#1677ed] hover:bg-blue-50/60'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>💻 단독 모드 (엑셀 일괄)</span>
          </button>
          <button
            type="button"
            onClick={() => setMainMode('collab')}
            className={`px-4 py-2.5 text-sm font-semibold rounded-full flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 cursor-pointer ${
              mainMode === 'collab'
                ? 'bg-[#1677ed] text-white shadow-sm'
                : 'text-[#354c75] hover:text-[#1677ed] hover:bg-blue-50/60'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>🤝 동학년 실시간 협업</span>
          </button>
        </div>

        {mainMode === 'collab' ? (
          /* 동학년 실시간 협업 모드 */
          <CollaborativeWorkspace onBackToStandalone={() => setMainMode('standalone')} />
        ) : (
          /* 기존 단독 모드 */
          <>
            {/* Mode Selector Toggle */}
            <div className="max-w-xl mb-6 bg-blue-50/60 p-1.5 rounded-full grid grid-cols-1 sm:grid-cols-2 gap-1.5 border border-blue-100">
              <button
                type="button"
                onClick={() => setMode('standard')}
                className={`px-4 py-2 text-sm font-semibold rounded-full flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  mode === 'standard'
                    ? 'bg-[#1677ed] text-white shadow-sm'
                    : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white/70'
                }`}
              >
                <Layers className="w-4 h-4 mr-2" />
                표준 템플릿 편성 모드
              </button>
              <button
                type="button"
                onClick={() => setMode('dynamic')}
                className={`px-4 py-2 text-sm font-semibold rounded-full flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  mode === 'dynamic'
                    ? 'bg-[#1677ed] text-white shadow-sm'
                    : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white/70'
                }`}
              >
                <Sliders className="w-4 h-4 mr-2" />
                자율 기준 동적 편성 모드 (데모)
              </button>
            </div>

            {mode === 'standard' ? (
              <>
            {/* Step Indicator */}
        <div className="bg-white border border-[#dce7f3] rounded-2xl p-3 sm:p-4 mb-6 grid grid-cols-3 gap-2 max-w-3xl shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
            {[
                { n: 1, t: '데이터 준비' },
                { n: 2, t: '설정' },
                { n: 3, t: '결과 확인' }
            ].map((s, idx) => (
                <div key={s.n} className={`flex min-w-0 flex-col sm:flex-row items-center justify-center gap-2 ${step >= s.n ? 'text-blue-700' : 'text-slate-500'}`}>
                    <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${step >= s.n ? 'bg-[#1677ed] text-white shadow-sm' : 'bg-slate-100 text-slate-500'}`}>
                        {s.n}
                    </div>
                    <span className="text-xs sm:text-sm font-semibold text-center">{s.t}</span>
                    {idx < 2 && <ArrowRight className="w-4 h-4 shrink-0 ml-2 text-blue-200 hidden sm:block" />}
                </div>
            ))}
        </div>

        {/* Step 1: Upload */}
        <div className={`transition-all duration-500 ${step === 1 ? 'opacity-100 translate-x-0' : 'hidden opacity-0 -translate-x-full'}`}>
            <div className="space-y-5">
                <div className="pt-1 pb-1">
                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#071747] flex items-center">
                        <Upload className="w-10 h-10 p-2 mr-3 rounded-2xl bg-blue-100 text-[#1677ed] shrink-0" />
                        1단계: 학생 데이터 업로드
                    </h2>
                </div>
                
                <div className="grid md:grid-cols-2 gap-4 lg:gap-6 items-stretch">
                    <div className="min-w-0 flex flex-col justify-between gap-6 rounded-2xl border border-[#dce7f3] bg-white p-5 sm:p-6 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                        <div className="space-y-3">
                            <h3 className="text-base font-bold text-[#172b4d] flex items-center">
                                <AlertTriangle className="w-6 h-6 p-1 mr-2 rounded-lg bg-amber-50 text-amber-600" /> 준비사항
                            </h3>
                            <p className="text-sm text-slate-600 leading-6">
                                제공된 <strong>엑셀 템플릿</strong>을 다운로드하여 학생 정보를 입력해주세요.<br/>
                                필수: 이름, 성별, 생년월일, 현학급<br/>
                                생활지도는 <strong>상/중/하</strong>로 입력합니다.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2.5 border-t border-[#dce7f3] pt-4">
                            <button onClick={generateTemplate} className="flex-1 py-2.5 px-4 bg-white hover:bg-blue-50 border border-blue-200 text-[#1677ed] rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center justify-center shadow-sm">
                                <Download className="w-4 h-4 mr-2" /> 템플릿 다운로드
                            </button>
                            <button onClick={generateSampleData} className="flex-1 py-2.5 px-4 bg-white hover:bg-blue-50 border border-blue-200 text-[#1677ed] rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center justify-center shadow-sm">
                                <FileSpreadsheet className="w-4 h-4 mr-2" /> 샘플 데이터
                            </button>
                        </div>
                    </div>

                    <div className="min-w-0 flex flex-col rounded-2xl border border-[#dce7f3] bg-white p-3 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 min-w-0 min-h-[260px] border-2 border-dashed border-blue-200 rounded-xl bg-[#f8fbff] hover:bg-blue-50/70 hover:border-[#1677ed] transition-colors cursor-pointer flex flex-col items-center justify-center px-5 py-7 text-center group"
                        >
                            <div className="w-16 h-16 bg-[#1677ed] rounded-2xl flex items-center justify-center mb-4 group-hover:bg-[#0b65d4] transition-colors shadow-sm">
                                <Upload className="w-8 h-8 text-white" />
                            </div>
                            <p className="text-base sm:text-lg font-bold text-[#071747] mb-2 leading-7">엑셀 파일을 드래그하거나 클릭하세요</p>
                            <p className="text-sm text-slate-500">.xlsx, .xls 파일 지원</p>
                            {fileName && (
                                <div className="mt-3 max-w-full break-all px-3.5 py-1.5 bg-white border border-blue-200 rounded-full text-[#1677ed] font-semibold text-sm flex items-center shadow-sm">
                                    <CheckCircle className="w-4 h-4 mr-2 text-emerald-500" /> {fileName}
                                </div>
                            )}
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
                    </div>
                </div>

                {students.length > 0 && (
                    <div className="bg-white px-5 py-4 sm:px-6 border border-[#dce7f3] rounded-2xl shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                                <span>총 학생: <strong className="text-[#071747]">{students.length}명</strong></span>
                                <span>남: <strong className="text-[#1677ed]">{maleCount}명</strong></span>
                                <span>여: <strong className="text-pink-600">{femaleCount}명</strong></span>
                                <span>동명이인: <strong className="text-rose-600">{dupCount}명</strong></span>
                            </div>
                            <button 
                                onClick={() => setStep(2)}
                                className="px-6 py-2.5 bg-[#1677ed] hover:bg-[#0b65d4] text-white rounded-full text-sm font-semibold transition-all shadow-sm hover:shadow flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                                다음 단계 <ArrowRight className="w-5 h-5 ml-2" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Step 2: Settings */}
        <div className={`transition-all duration-500 ${step === 2 ? 'opacity-100 translate-x-0' : 'hidden opacity-0 translate-x-full'}`}>
            <div className="space-y-5">
                <div className="pt-1 pb-1 flex flex-wrap justify-between items-center gap-3">
                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#071747] flex items-center">
                        <Settings className="w-10 h-10 p-2 mr-3 rounded-2xl bg-blue-100 text-[#1677ed] shrink-0" />
                        2단계: 편성 규칙 설정
                    </h2>
                    <button onClick={() => setStep(1)} className="px-5 py-2 bg-white hover:bg-blue-50 border border-blue-200 rounded-full text-sm text-[#1677ed] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 shadow-sm">이전으로</button>
                </div>
                
                <div className="space-y-5">
                    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="min-w-0 space-y-3 rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <label className="block text-sm font-semibold text-[#172b4d]">현재 학급 수</label>
                            <input 
                                type="number" 
                                value={settings.currentClassCount}
                                onChange={e => setSettings({...settings, currentClassCount: Number(e.target.value)})}
                                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-[#dce7f3] bg-[#f8fbff] text-base font-semibold text-[#071747] outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/15 focus:border-[#1677ed] transition-colors"
                            />
                        </div>
                        <div className="min-w-0 space-y-3 rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <label className="block text-sm font-semibold text-[#172b4d]">편성할 학급 수</label>
                            <input 
                                type="number" 
                                value={settings.nextClassCount}
                                onChange={e => setSettings({...settings, nextClassCount: Number(e.target.value)})}
                                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-[#dce7f3] bg-[#f8fbff] text-base font-semibold text-[#071747] outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/15 focus:border-[#1677ed] transition-colors"
                            />
                        </div>
                        <div className="min-w-0 space-y-3 rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <label className="block text-sm font-semibold text-[#172b4d]">학급당 기준 인원</label>
                            <input 
                                type="number" 
                                value={settings.normalCapacity}
                                onChange={e => setSettings({...settings, normalCapacity: Number(e.target.value)})}
                                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-[#dce7f3] bg-[#f8fbff] text-base font-semibold text-[#071747] outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/15 focus:border-[#1677ed] transition-colors"
                            />
                        </div>
                        <div className="min-w-0 space-y-3 rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <label className="block text-sm font-semibold text-[#172b4d]">통합학급 감축 인원</label>
                            <input 
                                type="number" 
                                value={settings.reductionCount}
                                onChange={e => setSettings({...settings, reductionCount: Number(e.target.value)})}
                                className="w-full min-w-0 px-3.5 py-2.5 rounded-xl border border-[#dce7f3] bg-[#f8fbff] text-base font-semibold text-[#071747] outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/15 focus:border-[#1677ed] transition-colors"
                            />
                            <p className="text-xs leading-5 text-slate-500">통합학급은 일반학급보다 이만큼 적게 배정합니다.</p>
                        </div>
                        <div className="min-w-0 space-y-3 sm:col-span-2 xl:col-span-4 rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <label className="block text-sm font-semibold text-[#172b4d]">배치 방식</label>
                            <div className="grid sm:grid-cols-2 gap-3">
                                <button 
                                    onClick={() => setSettings({...settings, placementOrder: 'zigzag'})}
                                    className={`p-4 rounded-2xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${settings.placementOrder === 'zigzag' ? 'border-[#1677ed] bg-[#1677ed] text-white shadow-sm' : 'border-[#dce7f3] bg-[#f8fbff] text-[#172b4d] hover:border-[#1677ed] hover:bg-blue-50/70'}`}
                                >
                                    <div className="text-base font-bold mb-1">S자 (지그재그)</div>
                                    <div className="text-sm leading-6 opacity-90">1반→2반...끝반→끝반... 반대로 돌아오며 배치</div>
                                </button>
                                <button 
                                    onClick={() => setSettings({...settings, placementOrder: 'linear'})}
                                    className={`p-4 rounded-2xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${settings.placementOrder === 'linear' ? 'border-[#1677ed] bg-[#1677ed] text-white shadow-sm' : 'border-[#dce7f3] bg-[#f8fbff] text-[#172b4d] hover:border-[#1677ed] hover:bg-blue-50/70'}`}
                                >
                                    <div className="text-base font-bold mb-1">순차 배치</div>
                                    <div className="text-sm leading-6 opacity-90">1반→2반...끝반→1반 순서대로 계속 배치</div>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 쌍둥이 배정 옵션 설정 섹션 */}
                    {twinGroups.length > 0 && (
                        <div className="rounded-2xl border border-[#dce7f3] bg-white p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <div className="mb-4">
                                <h3 className="text-base sm:text-lg font-bold text-[#071747] flex items-center">
                                    <Users className="w-5 h-5 mr-2 text-[#1677ed] shrink-0" />
                                    👶 쌍둥이 배정 방식 선택 ({twinGroups.length}쌍 감지됨)
                                </h3>
                                <p className="text-xs leading-5 text-slate-500 mt-1">
                                    학부모 및 학생 희망에 따라 각 쌍둥이별로 서로 다른 반(분리) 또는 같은 반(동일)을 선택해주세요.
                                </p>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                {twinGroups.map((group, gIdx) => {
                                    const isSameClass = group.members.some(m => m.쌍둥이옵션 === '동일');
                                    const handleTwinOptionChange = (option: '분리' | '동일') => {
                                        setStudents(prev => prev.map(s => {
                                             if (group.members.some(m => m.id === s.id)) {
                                                return { ...s, 쌍둥이옵션: option };
                                            }
                                            return s;
                                        }));
                                    };

                                    return (
                                        <div key={group.key} className="p-4 bg-[#f8fbff] rounded-2xl border border-[#dce7f3] flex flex-col justify-between">
                                            <div className="mb-3">
                                                <div className="text-sm font-bold text-[#172b4d] flex flex-wrap items-center gap-2">
                                                    <span>쌍둥이 {gIdx + 1}</span>
                                                    <span className="text-xs font-normal text-slate-500">
                                                        ({group.members[0].생년월일 || '생년월일 미입력'})
                                                    </span>
                                                </div>
                                                <div className="text-sm text-slate-600 mt-2 flex flex-wrap gap-2">
                                                    {group.members.map(m => (
                                                        <span key={m.id} className="bg-white px-3 py-1 rounded-full border border-blue-100 font-semibold text-xs text-[#354c75] shadow-sm">
                                                            {m.현학급}반 {m.이름} ({m.성별})
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="grid sm:grid-cols-2 gap-2 mt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => handleTwinOptionChange('분리')}
                                                    className={`py-2 px-3 rounded-full border text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center justify-center gap-1.5 ${
                                                        !isSameClass
                                                            ? 'bg-[#1677ed] border-[#1677ed] text-white shadow-sm'
                                                            : 'bg-white text-[#354c75] border-blue-200 hover:bg-blue-50'
                                                    }`}
                                                >
                                                    <span>🚫 다른 반 (분리 배정)</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleTwinOptionChange('동일')}
                                                    className={`py-2 px-3 rounded-full border text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center justify-center gap-1.5 ${
                                                        isSameClass
                                                            ? 'bg-[#1677ed] border-[#1677ed] text-white shadow-sm'
                                                            : 'bg-white text-[#354c75] border-blue-200 hover:bg-blue-50'
                                                    }`}
                                                >
                                                    <span>🤝 같은 반 (동반 배정)</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="rounded-2xl bg-blue-50/60 border border-blue-100 px-5 py-4 flex justify-end shadow-sm">
                    <button 
                        onClick={handleRunAlgorithm}
                        disabled={loading}
                        className="w-full sm:w-auto justify-center px-7 py-3 bg-[#1677ed] hover:bg-[#0b65d4] text-white rounded-full text-sm font-bold transition-all shadow-sm hover:shadow flex items-center disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                    >
                        {loading ? (
                           <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                        ) : (
                           <Users className="w-5 h-5 mr-2" />
                        )}
                        학급 편성 실행
                    </button>
                </div>
            </div>
        </div>

        {/* Step 3: Results */}
        <div className={`transition-all duration-500 ${step === 3 ? 'opacity-100 translate-x-0' : 'hidden opacity-0 translate-x-full'}`}>
            {result && (() => {
                const allAssignedStudents = (Object.values(result.assignments).flat() as Student[]);
                const oldClassNumbers = Array.from(new Set(allAssignedStudents.map(s => s.현학급))).sort((a, b) => a - b);

                const isSpecialStudent = (s: Student) => {
                    return !!(s.동명이인 || s.전출예정 || s.학습부진 || s.생활지도 || s.학생선수 || s.통합학급 || s.학부모민원 || s.쌍둥이 || s.분리배정);
                };

                const totalSpecialCount = allAssignedStudents.filter(isSpecialStudent).length;

                // 탭 및 모드별 기본 학생 목록
                let currentGroupStudents: Student[] = [];
                if (activeTab === 'SPECIAL_DASHBOARD') {
                    currentGroupStudents = allAssignedStudents
                        .filter(isSpecialStudent)
                        .sort((a, b) => (a.배정학급 || '').localeCompare(b.배정학급 || '') || (a.출석번호 || 0) - (b.출석번호 || 0));
                } else if (resultViewMode === 'newClass') {
                    if (activeTab === 'ALL') {
                        currentGroupStudents = [...allAssignedStudents].sort((a, b) => 
                            (a.배정학급 || '').localeCompare(b.배정학급 || '') || (a.출석번호 || 0) - (b.출석번호 || 0)
                        );
                    } else {
                        currentGroupStudents = result.assignments[activeTab] || [];
                    }
                } else {
                    if (activeTab === 'ALL') {
                        currentGroupStudents = [...allAssignedStudents].sort((a, b) => 
                            a.현학급 - b.현학급 || (Number(a.번호) || 0) - (Number(b.번호) || 0)
                        );
                    } else {
                        const targetOldClass = Number(activeTab);
                        currentGroupStudents = allAssignedStudents
                            .filter(s => s.현학급 === targetOldClass)
                            .sort((a, b) => (Number(a.번호) || 0) - (Number(b.번호) || 0));
                    }
                }

                // 특이사항 필터 적용
                const displayedStudents = filterSpecialOnly
                    ? currentGroupStudents.filter(isSpecialStudent)
                    : currentGroupStudents;

                // 기존반 기준 분산 통계
                const oldClassDistribution: Record<string, number> = {};
                if (resultViewMode === 'oldClass' && activeTab !== 'ALL') {
                    currentGroupStudents.forEach(s => {
                        if (s.배정학급) {
                            oldClassDistribution[s.배정학급] = (oldClassDistribution[s.배정학급] || 0) + 1;
                        }
                    });
                }

                return (
                    <div className="space-y-4">
                        <div className="pt-1 pb-1 flex items-center">
                            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#071747] flex items-center">
                                <CheckCircle aria-hidden="true" className="w-10 h-10 p-2 mr-3 rounded-2xl bg-blue-100 text-[#1677ed] shrink-0" />
                                3단계: 결과 확인
                            </h2>
                        </div>
                        {/* Stats Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1677ed]"><Users aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">총 학생</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.totalStudents}명</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Layers aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">편성 학급</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.activeClassNames.length}개 반</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><ShieldCheck aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">생활지도 '상'</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.highGuidance}명</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Users aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">통합 학급</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.integrated}명</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><BookOpen aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">학습부진</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.underachieving ?? allAssignedStudents.filter(s => s.학습부진).length}명</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)]">
                                <div className="flex items-center gap-2 mb-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600"><CheckCircle aria-hidden="true" className="h-4 w-4" /></span><span className="text-xs font-semibold text-slate-600">운동부(선수)</span></div>
                                <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.athletes ?? allAssignedStudents.filter(s => s.학생선수).length}명</div>
                            </div>
                        </div>

                        {/* 보기 기준 전환 및 특이사항 필터 컨트롤 바 */}
                        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 bg-white rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-[#172b4d] mr-1">보기 기준:</span>
                                <div className="inline-flex flex-wrap gap-1 rounded-full bg-blue-50/80 p-1 border border-blue-100">
                                    <button
                                        type="button"
                                        onClick={() => { setResultViewMode('newClass'); setActiveTab('ALL'); }}
                                        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center gap-1.5 ${
                                            resultViewMode === 'newClass'
                                                ? 'bg-[#1677ed] text-white shadow-sm'
                                                : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white/60'
                                        }`}
                                    >
                                        <span>🏫 배정반(새 학급) 기준</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setResultViewMode('oldClass'); setActiveTab('ALL'); }}
                                        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center gap-1.5 ${
                                            resultViewMode === 'oldClass'
                                                ? 'bg-[#1677ed] text-white shadow-sm'
                                                : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white/60'
                                        }`}
                                    >
                                        <span>📋 기존반(현재 학급) 기준</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFilterSpecialOnly(prev => !prev)}
                                    className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center gap-2 border ${
                                        filterSpecialOnly
                                            ? 'bg-amber-100 text-amber-950 border-amber-500 ring-1 ring-amber-500'
                                            : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                                    }`}
                                >
                                    <span>⭐ 특이사항 있는 학생만 모아보기</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                                        filterSpecialOnly ? 'bg-white text-amber-600' : 'bg-amber-100 text-amber-800'
                                    }`}>
                                        {totalSpecialCount}명
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* 메인 결과 테이블 카드 */}
                        <div className="bg-white rounded-2xl border border-[#dce7f3] shadow-[0_2px_8px_rgba(20,65,120,0.04)] overflow-hidden">
                            {/* 상단 탭 */}
                            <div className="p-3 sm:p-4 border-b border-[#dce7f3] flex justify-between items-center bg-[#f8fbff] overflow-x-auto">
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => setActiveTab('ALL')}
                                        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap ${activeTab === 'ALL' ? 'bg-[#1677ed] text-white shadow-sm' : 'text-[#354c75] bg-white hover:bg-blue-50 border border-[#dce7f3]'}`}
                                    >
                                        전체 보기 ({allAssignedStudents.length}명)
                                    </button>
                                    <button 
                                        onClick={() => setActiveTab('SPECIAL_DASHBOARD')}
                                        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap flex items-center gap-1.5 border ${activeTab === 'SPECIAL_DASHBOARD' ? 'bg-amber-100 text-amber-950 border-amber-500 shadow-sm' : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'}`}
                                    >
                                        <span>⭐ 특이사항 종합 대시보드</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-extrabold ${activeTab === 'SPECIAL_DASHBOARD' ? 'bg-white text-amber-700' : 'bg-amber-200 text-amber-900'}`}>
                                            {totalSpecialCount}명
                                        </span>
                                    </button>
                                    {resultViewMode === 'newClass' ? (
                                        result.activeClassNames.map(name => {
                                            const classStudents = result.assignments[name] || [];
                                            const integratedCount = classStudents.filter(s => s.통합학급).length;
                                            return (
                                                <button 
                                                    key={name}
                                                    onClick={() => setActiveTab(name)}
                                                    className={`px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap flex items-center gap-1.5 ${activeTab === name ? 'bg-[#1677ed] text-white shadow-sm' : 'text-[#354c75] bg-white hover:bg-blue-50 border border-[#dce7f3]'}`}
                                                >
                                                    <span>{name}반</span>
                                                    <span className="text-xs opacity-80 font-normal">({classStudents.length})</span>
                                                    {integratedCount > 0 && (
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold flex items-center gap-0.5 ${
                                                            activeTab === name 
                                                                ? 'bg-emerald-400 text-emerald-950 ring-1 ring-white' 
                                                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                                        }`}>
                                                            🌿통합(-{settings.reductionCount * integratedCount})
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })
                                    ) : (
                                        oldClassNumbers.map(classNum => {
                                            const count = allAssignedStudents.filter(s => s.현학급 === classNum).length;
                                            return (
                                                <button 
                                                    key={classNum}
                                                    onClick={() => setActiveTab(String(classNum))}
                                                    className={`px-3 py-2 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap ${activeTab === String(classNum) ? 'bg-blue-600 text-white' : 'text-[#354c75] bg-white hover:bg-blue-100 ring-1 ring-inset ring-blue-100'}`}
                                                >
                                                    {classNum}반 <span className="text-xs opacity-80 font-normal ml-1">({count})</span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                                <div className="flex gap-2 ml-4">
                                    <button onClick={() => setStep(2)} title="설정으로 돌아가기" className="p-2 rounded-lg border border-blue-100 bg-white text-blue-600 hover:bg-blue-100">
                                        <RefreshCw className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 sm:p-5">
                                {/* ========================================================================= */}
                                {/* 특이사항 종합 대시보드 전용 뷰 */}
                                {/* ========================================================================= */}
                                {activeTab === 'SPECIAL_DASHBOARD' && (
                                    <div className="mb-5 space-y-4">
                                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-wrap items-center justify-between gap-4">
                                            <div className="flex items-center gap-3">
                                                <span className="text-3xl">⭐</span>
                                                <div>
                                                    <h3 className="font-extrabold text-lg text-amber-950">전교 특이사항 종합 분포 비교 대시보드</h3>
                                                    <p className="text-xs sm:text-sm text-amber-800 mt-0.5">
                                                        모든 학급의 특수(통합), 생활지도(상·중·하), 학습부진, 운동부, 쌍둥이, 분리요청 균등 분산 현황을 한눈에 비교 검토합니다.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-xs text-amber-800 font-bold">특이사항 총 학생수: </span>
                                                <span className="px-2.5 py-1 bg-amber-600 text-white font-extrabold rounded-lg text-sm shadow-none">{totalSpecialCount}명</span>
                                            </div>
                                        </div>

                                        {/* 반별 특이사항 분포 비교 매트릭스 테이블 */}
                                        <div className="overflow-x-auto border border-gray-200 rounded-xl shadow-none bg-white">
                                            <table className="w-full text-xs sm:text-sm text-center border-collapse">
                                                <thead className="text-xs uppercase bg-slate-800 text-white font-bold">
                                                    <tr>
                                                        <th className="py-3 px-3">학급</th>
                                                        <th className="py-3 px-3">총 배정인원</th>
                                                        <th className="py-3 px-3 bg-emerald-800/90 text-white">🌿 특수(통합)</th>
                                                        <th className="py-3 px-3 bg-red-800/90 text-white">생활(상)</th>
                                                        <th className="py-3 px-3">생활(중)</th>
                                                        <th className="py-3 px-3">생활(하)</th>
                                                        <th className="py-3 px-3 bg-amber-800/90 text-white">학습부진</th>
                                                        <th className="py-3 px-3 bg-blue-800/90 text-white">운동부</th>
                                                        <th className="py-3 px-3">쌍둥이</th>
                                                        <th className="py-3 px-3">분리요청</th>
                                                        <th className="py-3 px-3">전출예정</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {result.activeClassNames.map(name => {
                                                        const cStudents = result.assignments[name] || [];
                                                        const specCount = cStudents.filter(s => s.통합학급).length;
                                                        const highCount = cStudents.filter(s => s.생활지도 === '상').length;
                                                        const midCount = cStudents.filter(s => s.생활지도 === '중').length;
                                                        const lowCount = cStudents.filter(s => s.생활지도 === '하').length;
                                                        const underCount = cStudents.filter(s => s.학습부진).length;
                                                        const athleteCount = cStudents.filter(s => s.학생선수).length;
                                                        const twinCount = cStudents.filter(s => s.쌍둥이).length;
                                                        const sepCount = cStudents.filter(s => s.분리배정).length;
                                                        const transferCount = cStudents.filter(s => s.전출예정).length;
                                                        return (
                                                            <tr key={name} className="hover:bg-slate-50 transition-colors font-medium">
                                                                <td className="py-2.5 px-3 font-bold text-blue-700">{name}반</td>
                                                                <td className="py-2.5 px-3">
                                                                    <span className="font-bold">{cStudents.length}명</span>
                                                                    {specCount > 0 && (
                                                                        <span className="text-[11px] text-emerald-600 ml-1 font-bold">
                                                                            (🌿-{settings.reductionCount * specCount})
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className={`py-2.5 px-3 ${specCount > 0 ? 'bg-emerald-50 text-emerald-800 font-extrabold' : 'text-gray-400'}`}>
                                                                    {specCount > 0 ? `🌿 ${specCount}명` : '-'}
                                                                </td>
                                                                <td className={`py-2.5 px-3 ${highCount > 0 ? 'bg-red-50 text-red-700 font-extrabold' : 'text-gray-400'}`}>
                                                                    {highCount > 0 ? `${highCount}명` : '-'}
                                                                </td>
                                                                <td className="py-2.5 px-3 text-gray-700">{midCount > 0 ? `${midCount}명` : '-'}</td>
                                                                <td className="py-2.5 px-3 text-gray-700">{lowCount > 0 ? `${lowCount}명` : '-'}</td>
                                                                <td className={`py-2.5 px-3 ${underCount > 0 ? 'bg-amber-50 text-amber-800 font-bold' : 'text-gray-400'}`}>
                                                                    {underCount > 0 ? `${underCount}명` : '-'}
                                                                </td>
                                                                <td className={`py-2.5 px-3 ${athleteCount > 0 ? 'bg-blue-50 text-blue-800 font-bold' : 'text-gray-400'}`}>
                                                                    {athleteCount > 0 ? `${athleteCount}명` : '-'}
                                                                </td>
                                                                <td className="py-2.5 px-3 text-gray-600">{twinCount > 0 ? `${twinCount}명` : '-'}</td>
                                                                <td className="py-2.5 px-3 text-gray-600">{sepCount > 0 ? `${sepCount}명` : '-'}</td>
                                                                <td className="py-2.5 px-3 text-gray-500">{transferCount > 0 ? `${transferCount}명` : '-'}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className="flex items-center justify-between pt-2">
                                            <h4 className="font-extrabold text-gray-800 text-base flex items-center gap-2">
                                                <span>📋 전교 특이사항 학생 명렬표</span>
                                                <span className="text-xs text-gray-500 font-normal">
                                                    (아래 표에서 학생의 배정반을 직접 변경하거나 1:1 맞교환할 수 있습니다)
                                                </span>
                                            </h4>
                                        </div>
                                    </div>
                                )}

                                {/* 요약 카드: 배정반 기준 */}
                                {resultViewMode === 'newClass' && activeTab !== 'ALL' && activeTab !== 'SPECIAL_DASHBOARD' && (() => {
                                    const targetStudents = result.assignments[activeTab] || [];
                                    const integratedCount = targetStudents.filter(s => s.통합학급).length;
                                    const totalReduction = settings.reductionCount * integratedCount;
                                    return (
                                        <div className="mb-4 space-y-2">
                                            {integratedCount > 0 && (
                                                <div className="p-3.5 bg-emerald-50 border-2 border-emerald-400 rounded-xl flex flex-wrap items-center justify-between gap-3 text-emerald-900 shadow-none">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="text-2xl">🌿</span>
                                                        <div>
                                                            <div className="font-extrabold text-sm sm:text-base text-emerald-950 flex items-center gap-2">
                                                                <span>특수교육(통합)학급 학생 배정 학급</span>
                                                                <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-full font-bold">
                                                                    특수학생 {integratedCount}명
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-emerald-700 mt-1 font-medium leading-relaxed">
                                                                특수학급 학생 배정으로 일반 정원 <strong>-{totalReduction}명 감축</strong>이 적용된 학급입니다. (현재 {targetStudents.length}명 배정 ➡️ 실질 체감 정원 {targetStudents.length + totalReduction}명 상당)
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="px-3 py-1 bg-emerald-600 text-white text-xs font-extrabold rounded-lg shadow-none">
                                                        정원 감축 적용반 (-{totalReduction}명)
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex flex-wrap items-center gap-4 text-sm bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                                                <div className="font-bold text-blue-900">{activeTab}반 요약:</div>
                                                <div>총원: <strong className="text-gray-900">{targetStudents.length}명</strong></div>
                                                <div>남: <span className="text-blue-600 font-bold">{targetStudents.filter(s => s.성별 === '남성').length}명</span></div>
                                                <div>여: <span className="text-pink-600 font-bold">{targetStudents.filter(s => s.성별 === '여성').length}명</span></div>
                                                <div>생활지도(상): <span className="text-orange-600 font-bold">{targetStudents.filter(s => s.생활지도 === '상').length}명</span></div>
                                                <div>학습부진: <span className="text-amber-700 font-bold">{targetStudents.filter(s => s.학습부진).length}명</span></div>
                                                <div>운동부: <span className="text-blue-700 font-bold">{targetStudents.filter(s => s.학생선수).length}명</span></div>
                                                {integratedCount > 0 && (
                                                    <div className="text-emerald-800 font-bold flex items-center gap-1">
                                                        <span>🌿 특수(통합): {integratedCount}명</span>
                                                        <span className="text-xs text-emerald-600 font-normal">(-{totalReduction}명 감축)</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* 요약 카드: 기존반 기준 */}
                                {resultViewMode === 'oldClass' && activeTab !== 'ALL' && activeTab !== 'SPECIAL_DASHBOARD' && (
                                    <div className="mb-4 bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                                        <div className="font-bold text-blue-900 mb-2">
                                            기존 {activeTab}반 학생 (총 {currentGroupStudents.length}명) ➡️ 배정 학급별 분산 현황:
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {result.activeClassNames.map(cName => {
                                                const count = oldClassDistribution[cName] || 0;
                                                const isTargetIntegrated = result.assignments[cName]?.some(s => s.통합학급);
                                                return (
                                                    <span key={cName} className={`px-2.5 py-1 rounded-md text-xs font-semibold border flex items-center gap-1.5 ${
                                                        count > 0 ? 'bg-white border-blue-200 text-blue-800 shadow-none' : 'bg-gray-100 text-gray-400 border-gray-200'
                                                    }`}>
                                                        <span>{cName}반: {count}명</span>
                                                        {isTargetIntegrated && (
                                                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded font-bold border border-emerald-300" title="통합학급 (정원감축반)">
                                                                🌿통합
                                                            </span>
                                                        )}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* 특이사항 필터 활성화 배너 */}
                                {filterSpecialOnly && activeTab !== 'SPECIAL_DASHBOARD' && (
                                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-sm text-amber-800">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold">⭐ 특이사항 필터 적용 중:</span>
                                            <span>선택된 범위 내 특이사항 학생 <strong>{displayedStudents.length}명</strong>만 표시됩니다.</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setFilterSpecialOnly(false)}
                                            className="text-xs font-bold underline hover:text-amber-900"
                                        >
                                            전체 학생 보기로 전환
                                        </button>
                                    </div>
                                )}

                                {/* 맞교환(Swap) 모드 활성화 배너 */}
                                {swapCandidate && (
                                    <div className="mb-4 p-4 bg-amber-600 text-white rounded-xl shadow-none flex flex-wrap items-center justify-between gap-3 animate-pulse">
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">🔄</span>
                                            <div>
                                                <div className="font-extrabold text-sm sm:text-base">
                                                    [{swapCandidate.배정학급}반 {swapCandidate.이름}] 학생과 맞바꿀 다른 반 학생의 [🔄 맞교환] 버튼을 클릭하세요!
                                                </div>
                                                <div className="text-xs text-amber-100 mt-0.5">
                                                    서로 다른 반 학생끼리 1:1로 배정 학급이 안전하게 교체됩니다.
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSwapCandidate(null)}
                                            className="px-3 py-1.5 bg-white text-amber-700 font-bold text-xs rounded-lg shadow-none hover:bg-amber-50 transition"
                                        >
                                            맞교환 취소 ✕
                                        </button>
                                    </div>
                                )}

                                <ClassTable 
                                    students={displayedStudents} 
                                    showAssignedClass={true} 
                                    numberType={resultViewMode === 'oldClass' ? 'original' : 'assigned'}
                                    activeClassNames={result.activeClassNames}
                                    onClassChange={handleStudentClassChange}
                                    onSelectSwap={handleSelectSwap}
                                    swapCandidate={swapCandidate}
                                />
                            </div>
                             
                            <div className="p-4 bg-[#f8fbff] border-t border-[#dce7f3] flex flex-wrap justify-end gap-3">
                                <button 
                                    onClick={handleDownloadNewClass}
                                    className="px-5 py-2.5 bg-[#1677ed] hover:bg-[#0b65d4] text-white rounded-full text-sm font-semibold transition-all shadow-sm hover:shadow flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                >
                                    <Download className="w-5 h-5 mr-2" /> 
                                    배정 학급 기준 명렬표 다운로드
                                </button>
                                <button 
                                    onClick={handleDownloadOldClass}
                                    className="px-5 py-2.5 bg-white hover:bg-blue-50 border border-blue-200 text-[#1677ed] rounded-full text-sm font-semibold transition-all shadow-sm hover:shadow flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                >
                                    <FileSpreadsheet className="w-5 h-5 mr-2" /> 
                                    기존 학급 기준 명렬표 다운로드
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
          </>
        ) : (
          <DynamicWizard />
        )}
          </>
        )}

      </main>
      
      {/* Toast Error */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center animate-bounce">
            <AlertTriangle className="w-6 h-6 mr-3" />
            {error}
            <button onClick={() => setError(null)} className="ml-4 font-bold hover:opacity-75">✕</button>
        </div>
      )}

      {/* 📖 교사용 사용설명서 모달 */}
      <ManualModal
        isOpen={showManualModal}
        onClose={() => setShowManualModal(false)}
      />

    </div>
  );
};

export default App;
