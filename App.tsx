import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, Settings, Users, ArrowRight, CheckCircle, AlertTriangle, FileSpreadsheet, RefreshCw, Layers, Sliders, ShieldCheck } from 'lucide-react';
import { Student, ClassSettings, PlacementResult } from './types';
import { parseExcel, generateTemplate, generateSampleData, downloadResultsByNewClass, downloadResultsByOldClass } from './utils/excel';
import { runPlacementAlgorithm } from './utils/algorithm';
import ClassTable from './components/ClassTable';
import { DynamicWizard } from './components/DynamicWizard';

const App: React.FC = () => {
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
  const [activeTab, setActiveTab] = useState<string>('');

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

  // Preview Stats
  const maleCount = students.filter(s => s.성별 === '남성').length;
  const femaleCount = students.filter(s => s.성별 === '여성').length;
  const dupCount = students.filter(s => s.동명이인).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 pb-20">
      
      {/* Header */}
      <header className="bg-indigo-600 text-white pt-10 pb-24 px-4 shadow-lg">
        <div className="max-w-6xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-extrabold mb-4 tracking-tight drop-shadow-sm">
                🏫 학급 편성 마법사
            </h1>
            <p className="text-indigo-100 text-lg md:text-xl font-light max-w-2xl mx-auto">
                복잡한 학생 배정, 이제 클릭 한 번으로 끝내세요.<br/>
                성별, 성적, 생활지도 등 모든 조건을 고려하여 최적의 학급을 편성합니다.
            </p>
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-1.5 bg-indigo-500/30 border border-indigo-400/30 rounded-full text-xs text-indigo-100 backdrop-blur-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>개인정보 안심: 모든 데이터는 브라우저 내부(로컬)에서만 연산되며 절대 외부에 전송되지 않습니다.</span>
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 -mt-16">

        {/* Mode Selector Toggle */}
        <div className="max-w-3xl mx-auto mb-6 bg-white/80 backdrop-blur shadow p-1 rounded-xl flex gap-1 border border-indigo-100">
          <button
            onClick={() => setMode('standard')}
            className={`flex-1 py-3 text-sm font-bold rounded-lg flex items-center justify-center transition-all ${
              mode === 'standard'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
          >
            <Layers className="w-4 h-4 mr-2" />
            표준 템플릿 편성 모드
          </button>
          <button
            onClick={() => setMode('dynamic')}
            className={`flex-1 py-3 text-sm font-bold rounded-lg flex items-center justify-center transition-all ${
              mode === 'dynamic'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
          >
            <Sliders className="w-4 h-4 mr-2" />
            자율 기준 동적 편성 모드 (데모)
          </button>
        </div>

        {mode === 'standard' ? (
          <>
            {/* Step Indicator */}
        <div className="bg-white rounded-xl shadow-md p-4 mb-8 flex justify-around items-center max-w-3xl mx-auto">
            {[
                { n: 1, t: '데이터 준비' },
                { n: 2, t: '설정' },
                { n: 3, t: '결과 확인' }
            ].map((s, idx) => (
                <div key={s.n} className={`flex items-center ${step >= s.n ? 'text-indigo-600' : 'text-gray-400'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold mr-2 ${step >= s.n ? 'bg-indigo-100' : 'bg-gray-100'}`}>
                        {s.n}
                    </div>
                    <span className="font-medium hidden sm:inline">{s.t}</span>
                    {idx < 2 && <ArrowRight className="w-4 h-4 ml-4 text-gray-300 hidden sm:block" />}
                </div>
            ))}
        </div>

        {/* Step 1: Upload */}
        <div className={`transition-all duration-500 ${step === 1 ? 'opacity-100 translate-x-0' : 'hidden opacity-0 -translate-x-full'}`}>
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="p-8 border-b border-gray-100">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                        <Upload className="w-6 h-6 mr-3 text-indigo-500" /> 
                        1단계: 학생 데이터 업로드
                    </h2>
                </div>
                
                <div className="p-8 grid md:grid-cols-2 gap-10">
                    <div className="space-y-6">
                        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-lg">
                            <h3 className="font-bold text-blue-800 flex items-center mb-2">
                                <AlertTriangle className="w-4 h-4 mr-2" /> 준비사항
                            </h3>
                            <p className="text-sm text-blue-700 leading-relaxed">
                                제공된 <strong>엑셀 템플릿</strong>을 다운로드하여 학생 정보를 입력해주세요.<br/>
                                필수: 이름, 성별, 생년월일, 현학급<br/>
                                생활지도는 <strong>상/중/하</strong>로 입력합니다.
                            </p>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={generateTemplate} className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition flex items-center justify-center">
                                <Download className="w-4 h-4 mr-2" /> 템플릿 다운로드
                            </button>
                            <button onClick={generateSampleData} className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition flex items-center justify-center">
                                <FileSpreadsheet className="w-4 h-4 mr-2" /> 샘플 데이터
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col">
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 border-3 border-dashed border-indigo-200 rounded-xl bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-400 transition cursor-pointer flex flex-col items-center justify-center p-10 group"
                        >
                            <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <Upload className="w-8 h-8 text-indigo-500" />
                            </div>
                            <p className="text-lg font-medium text-gray-700 mb-1">엑셀 파일을 드래그하거나 클릭하세요</p>
                            <p className="text-sm text-gray-500">.xlsx, .xls 파일 지원</p>
                            {fileName && (
                                <div className="mt-4 px-4 py-2 bg-white rounded-full shadow-sm text-indigo-600 font-semibold text-sm flex items-center">
                                    <CheckCircle className="w-4 h-4 mr-2" /> {fileName}
                                </div>
                            )}
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
                    </div>
                </div>

                {students.length > 0 && (
                    <div className="bg-gray-50 p-8 border-t border-gray-100">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex gap-6 text-sm text-gray-600">
                                <span>총 학생: <strong className="text-gray-900">{students.length}명</strong></span>
                                <span>남: <strong className="text-blue-600">{maleCount}명</strong></span>
                                <span>여: <strong className="text-pink-600">{femaleCount}명</strong></span>
                                <span>동명이인: <strong className="text-red-600">{dupCount}명</strong></span>
                            </div>
                            <button 
                                onClick={() => setStep(2)}
                                className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition flex items-center"
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
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center">
                        <Settings className="w-6 h-6 mr-3 text-indigo-500" /> 
                        2단계: 편성 규칙 설정
                    </h2>
                    <button onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600 font-medium">이전으로</button>
                </div>
                
                <div className="p-8">
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">현재 학급 수</label>
                            <input 
                                type="number" 
                                value={settings.currentClassCount}
                                onChange={e => setSettings({...settings, currentClassCount: Number(e.target.value)})}
                                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">편성할 학급 수</label>
                            <input 
                                type="number" 
                                value={settings.nextClassCount}
                                onChange={e => setSettings({...settings, nextClassCount: Number(e.target.value)})}
                                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">학급당 기준 인원</label>
                            <input 
                                type="number" 
                                value={settings.normalCapacity}
                                onChange={e => setSettings({...settings, normalCapacity: Number(e.target.value)})}
                                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-gray-700">통합학급 감축 인원</label>
                            <input 
                                type="number" 
                                value={settings.reductionCount}
                                onChange={e => setSettings({...settings, reductionCount: Number(e.target.value)})}
                                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                            <p className="text-xs text-gray-500">통합학급은 일반학급보다 이만큼 적게 배정합니다.</p>
                        </div>
                        <div className="space-y-2 lg:col-span-2">
                            <label className="text-sm font-bold text-gray-700">배치 방식</label>
                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={() => setSettings({...settings, placementOrder: 'zigzag'})}
                                    className={`p-4 rounded-lg border-2 text-left transition ${settings.placementOrder === 'zigzag' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-gray-300'}`}
                                >
                                    <div className="font-bold mb-1">S자 (지그재그)</div>
                                    <div className="text-xs opacity-75">1반→2반...끝반→끝반... 반대로 돌아오며 배치</div>
                                </button>
                                <button 
                                    onClick={() => setSettings({...settings, placementOrder: 'linear'})}
                                    className={`p-4 rounded-lg border-2 text-left transition ${settings.placementOrder === 'linear' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-gray-300'}`}
                                >
                                    <div className="font-bold mb-1">순차 배치</div>
                                    <div className="text-xs opacity-75">1반→2반...끝반→1반 순서대로 계속 배치</div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 p-8 border-t border-gray-100 flex justify-end">
                    <button 
                        onClick={handleRunAlgorithm}
                        disabled={loading}
                        className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
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
            {result && (
                <div className="space-y-6">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">총 학생</div>
                            <div className="text-2xl font-bold text-gray-900">{result.stats.totalStudents}명</div>
                        </div>
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">편성 학급</div>
                            <div className="text-2xl font-bold text-indigo-600">{result.activeClassNames.length}개 반</div>
                        </div>
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">생활지도 '상'</div>
                            <div className="text-2xl font-bold text-orange-500">{result.stats.highGuidance}명</div>
                        </div>
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">통합 학급</div>
                            <div className="text-2xl font-bold text-green-600">{result.stats.integrated}명</div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 overflow-x-auto">
                            <div className="flex space-x-2">
                                <button 
                                    onClick={() => setActiveTab('ALL')}
                                    className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${activeTab === 'ALL' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}
                                >
                                    전체 보기
                                </button>
                                {result.activeClassNames.map(name => (
                                    <button 
                                        key={name}
                                        onClick={() => setActiveTab(name)}
                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${activeTab === name ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'}`}
                                    >
                                        {name}반 <span className="text-xs opacity-80 font-normal ml-1">({result.assignments[name].length})</span>
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2 ml-4">
                                <button onClick={() => setStep(2)} className="p-2 text-gray-400 hover:text-gray-600">
                                    <RefreshCw className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6">
                            {activeTab === 'ALL' ? (
                                <ClassTable students={(Object.values(result.assignments).flat() as Student[]).sort((a,b) => (a.배정학급 || '').localeCompare(b.배정학급 || '') || (a.출석번호 || 0) - (b.출석번호 || 0))} showAssignedClass={true} />
                            ) : (
                                <div>
                                    <div className="mb-4 flex flex-wrap gap-4 text-sm bg-gray-50 p-4 rounded-lg border border-gray-100">
                                        <div className="font-bold text-gray-700">{activeTab}반 요약:</div>
                                        <div>총원: <strong>{result.assignments[activeTab].length}명</strong></div>
                                        <div>남: <span className="text-blue-600 font-bold">{result.assignments[activeTab].filter(s => s.성별 === '남성').length}</span></div>
                                        <div>여: <span className="text-pink-600 font-bold">{result.assignments[activeTab].filter(s => s.성별 === '여성').length}</span></div>
                                        <div>생활지도(상): <span className="text-orange-600 font-bold">{result.assignments[activeTab].filter(s => s.생활지도 === '상').length}</span></div>
                                    </div>
                                    <ClassTable students={result.assignments[activeTab]} />
                                </div>
                            )}
                        </div>
                         
                        <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-center gap-4">
                            <button 
                                onClick={handleDownloadNewClass}
                                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition flex items-center"
                            >
                                <Download className="w-5 h-5 mr-2" /> 
                                배정 학급 기준 명렬표
                            </button>
                            <button 
                                onClick={handleDownloadOldClass}
                                className="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition flex items-center"
                            >
                                <FileSpreadsheet className="w-5 h-5 mr-2" /> 
                                기존 학급 기준 명렬표
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
          </>
        ) : (
          <DynamicWizard />
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

    </div>
  );
};

export default App;