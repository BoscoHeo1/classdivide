import React, { useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw, AlertTriangle, ArrowRight, Users, Layers, ShieldCheck, BookOpen, CheckCircle } from 'lucide-react';
import { PlacementResult, Student, ClassSettings } from '../types';
import ClassTable from './ClassTable';
import { downloadResultsByNewClass, downloadResultsByOldClass } from '../utils/excel';

interface PlacementResultDashboardProps {
  result: PlacementResult;
  allStudents: Student[];
  reductionCount?: number;
  onUpdateResult?: (updatedResult: PlacementResult) => void;
  onReset?: () => void;
  isReadOnly?: boolean;
}

export const PlacementResultDashboard: React.FC<PlacementResultDashboardProps> = ({
  result,
  allStudents,
  reductionCount = 2,
  onUpdateResult,
  onReset,
  isReadOnly = false
}) => {
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [resultViewMode, setResultViewMode] = useState<'newClass' | 'oldClass'>('newClass');
  const [filterSpecialOnly, setFilterSpecialOnly] = useState<boolean>(false);
  const [swapCandidate, setSwapCandidate] = useState<Student | null>(null);

  // 모든 배정된 학생 목록
  const allAssignedStudents: Student[] = Object.values<Student[]>(result.assignments).flat();

  // 기존 학급 번호 목록
  const oldClassNumbers = Array.from(new Set(allAssignedStudents.map(s => s.현학급))).sort((a, b) => a - b);

  // 현재 탭에 해당하는 학생 필터링
  let currentGroupStudents: Student[] = [];
  if (resultViewMode === 'newClass') {
    if (activeTab === 'ALL') {
      currentGroupStudents = allAssignedStudents;
    } else if (activeTab === 'SPECIAL_DASHBOARD') {
      currentGroupStudents = allAssignedStudents.filter(s =>
        s.통합학급 || !!s.생활지도 || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      );
    } else {
      currentGroupStudents = result.assignments[activeTab] || [];
    }
  } else {
    if (activeTab === 'ALL') {
      currentGroupStudents = allAssignedStudents;
    } else if (activeTab === 'SPECIAL_DASHBOARD') {
      currentGroupStudents = allAssignedStudents.filter(s =>
        s.통합학급 || !!s.생활지도 || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      );
    } else {
      const classNum = Number(activeTab);
      currentGroupStudents = allAssignedStudents.filter(s => s.현학급 === classNum);
    }
  }

  // 특이사항 체크 필터
  const displayedStudents = filterSpecialOnly
    ? currentGroupStudents.filter(s =>
        s.통합학급 || !!s.생활지도 || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      )
    : currentGroupStudents;

  // 특이사항 학생 총 수
  const totalSpecialCount = allAssignedStudents.filter(s =>
    s.통합학급 || !!s.생활지도 || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
  ).length;

  // 학생 수동 반 변경
  const handleStudentClassChange = (studentId: number, newClassName: string) => {
    if (isReadOnly || !onUpdateResult) return;

    let targetStudent: Student | null = null;
    let oldClass = '';

    for (const [cls, list] of Object.entries<Student[]>(result.assignments)) {
      const found = list.find(s => s.id === studentId);
      if (found) {
        targetStudent = found;
        oldClass = cls;
        break;
      }
    }

    if (!targetStudent || oldClass === newClassName) return;

    const newAssignments = { ...result.assignments };
    newAssignments[oldClass] = newAssignments[oldClass].filter(s => s.id !== studentId);
    const moved = { ...targetStudent, 배정학급: newClassName };
    newAssignments[newClassName] = [...(newAssignments[newClassName] || []), moved];

    // 표준 모드와 동일하게 전출예정 학생은 뒤로, 이름 가나다순 정렬 후 번호 재부여.
    result.activeClassNames.forEach(name => {
      newAssignments[name] = (newAssignments[name] || [])
        .slice()
        .sort((a, b) => {
          if (a.전출예정 && !b.전출예정) return 1;
          if (!a.전출예정 && b.전출예정) return -1;
          return a.이름.localeCompare(b.이름, 'ko');
        })
        .map((s, idx) => ({ ...s, 출석번호: idx + 1 }));
    });

    onUpdateResult({
      ...result,
      assignments: newAssignments
    });
  };

  // 맞교환(Swap)
  const handleSelectSwap = (student: Student) => {
    if (isReadOnly || !onUpdateResult) return;

    if (!swapCandidate) {
      setSwapCandidate(student);
      return;
    }

    if (swapCandidate.id === student.id) {
      setSwapCandidate(null);
      return;
    }

    const c1 = swapCandidate.배정학급;
    const c2 = student.배정학급;
    if (!c1 || !c2 || c1 === c2) {
      setSwapCandidate(student);
      return;
    }

    const first = result.assignments[c1]?.find(s => s.id === swapCandidate.id);
    const second = result.assignments[c2]?.find(s => s.id === student.id);
    if (!first || !second) return;

    const newAssignments = { ...result.assignments };
    newAssignments[c1] = newAssignments[c1].map(s => s.id === first.id ? { ...second, 배정학급: c1 } : s);
    newAssignments[c2] = newAssignments[c2].map(s => s.id === second.id ? { ...first, 배정학급: c2 } : s);

    // 표준 모드와 동일하게 전출예정 학생은 뒤로, 이름 가나다순 정렬 후 번호 재부여.
    result.activeClassNames.forEach(name => {
      newAssignments[name] = (newAssignments[name] || [])
        .slice()
        .sort((a, b) => {
          if (a.전출예정 && !b.전출예정) return 1;
          if (!a.전출예정 && b.전출예정) return -1;
          return a.이름.localeCompare(b.이름, 'ko');
        })
        .map((s, idx) => ({ ...s, 출석번호: idx + 1 }));
    });

    onUpdateResult({
      ...result,
      assignments: newAssignments
    });
    setSwapCandidate(null);
  };

  return (
    <div className="space-y-4">
      {/* 6대 핵심 지표 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1677ed] border border-blue-100/80">
              <Users aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">총 학생</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#1677ed]">{result.stats.totalStudents}명</div>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100/80">
              <Layers aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">편성 학급</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.activeClassNames.length}개 반</div>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 border border-rose-100/80">
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">생활지도 '상'</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.highGuidance}명</div>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100/80">
              <Users aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">통합 학급</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#071747]">{result.stats.integrated}명</div>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-100/80">
              <BookOpen aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">학습부진</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#071747]">
            {result.stats.underachieving ?? allAssignedStudents.filter(s => s.학습부진).length}명
          </div>
        </div>
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 border border-cyan-100/80">
              <CheckCircle aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-[#58708f]">운동부(선수)</span>
          </div>
          <div className="text-2xl font-extrabold tracking-tight text-[#071747]">
            {result.stats.athletes ?? allAssignedStudents.filter(s => s.학생선수).length}명
          </div>
        </div>
      </div>

      {/* 보기 기준 전환 및 특이사항 필터 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5 bg-white rounded-2xl border border-[#dce7f3] shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[#071747] mr-1">보기 기준:</span>
          <div className="inline-flex flex-wrap gap-1 rounded-xl bg-[#f8fbff] p-1 border border-[#dce7f3]">
            <button
              type="button"
              onClick={() => { setResultViewMode('newClass'); setActiveTab('ALL'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center gap-1.5 cursor-pointer ${
                resultViewMode === 'newClass'
                  ? 'bg-[#1677ed] text-white shadow-xs'
                  : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white'
              }`}
            >
              <span>🏫 배정반(새 학급) 기준</span>
            </button>
            <button
              type="button"
              onClick={() => { setResultViewMode('oldClass'); setActiveTab('ALL'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center gap-1.5 cursor-pointer ${
                resultViewMode === 'oldClass'
                  ? 'bg-[#1677ed] text-white shadow-xs'
                  : 'text-[#354c75] hover:text-[#1677ed] hover:bg-white'
              }`}
            >
              <span>📋 기존반(현재 학급) 기준</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-amber-900 bg-amber-50/80 px-3.5 py-2 rounded-xl border border-amber-200/80 cursor-pointer hover:bg-amber-100/70 transition-colors">
            <input
              type="checkbox"
              checked={filterSpecialOnly}
              onChange={(e) => setFilterSpecialOnly(e.target.checked)}
              className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
            />
            <span>⚠️ 특이사항 있는 학생만 보기</span>
          </label>
        </div>
      </div>

      {/* 맞교환 안내 바 */}
      {swapCandidate && !isReadOnly && (
        <div className="p-4 bg-blue-50/90 border border-blue-200 rounded-2xl shadow-[0_1px_3px_rgba(20,65,120,0.04)] flex flex-wrap gap-3 items-center justify-between text-xs text-[#071747]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[#1677ed]">🔄 맞교환 대상 선택됨:</span>
            <span className="px-2 py-0.5 bg-white border border-blue-200 rounded-md font-bold text-[#1677ed]">
              [{swapCandidate.배정학급}반 {swapCandidate.이름}]
            </span>
            <span className="text-[#354c75]">➔ 맞교환할 다른 반 학생의 [🔄 맞교환] 버튼을 클릭하세요.</span>
          </div>
          <button
            onClick={() => setSwapCandidate(null)}
            className="px-3 py-1.5 bg-white hover:bg-rose-50 text-[#58708f] hover:text-rose-600 border border-[#dce7f3] hover:border-rose-200 rounded-xl font-semibold transition-colors cursor-pointer"
          >
            취소
          </button>
        </div>
      )}

      {/* 메인 탭 컨테이너 */}
      <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(20,65,120,0.04)] border border-[#dce7f3] overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-[#dce7f3] flex justify-between items-center bg-[#f8fbff] overflow-x-auto gap-3">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer ${
                activeTab === 'ALL'
                  ? 'bg-[#1677ed] text-white shadow-xs border border-[#1677ed]'
                  : 'bg-white text-[#354c75] border border-[#dce7f3] hover:bg-blue-50/70 hover:text-[#1677ed]'
              }`}
            >
              전체 보기 ({allAssignedStudents.length}명)
            </button>
            <button
              onClick={() => setActiveTab('SPECIAL_DASHBOARD')}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap flex items-center gap-1.5 cursor-pointer border ${
                activeTab === 'SPECIAL_DASHBOARD'
                  ? 'bg-[#1677ed] text-white border-[#1677ed] shadow-xs'
                  : 'bg-amber-50/80 text-amber-900 border-amber-200/80 hover:bg-amber-100/70'
              }`}
            >
              <span>⭐ 특이사항 종합 대시보드</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-md font-bold ${
                activeTab === 'SPECIAL_DASHBOARD' ? 'bg-white/20 text-white' : 'bg-amber-200/80 text-amber-950'
              }`}>
                {totalSpecialCount}명
              </span>
            </button>

            {resultViewMode === 'newClass' ? (
              result.activeClassNames.map(name => {
                const classStudents = result.assignments[name] || [];
                const integratedCount = classStudents.filter(s => s.통합학급).length;
                const isCurrent = activeTab === name;
                return (
                  <button
                    key={name}
                    onClick={() => setActiveTab(name)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                      isCurrent
                        ? 'bg-[#1677ed] text-white shadow-xs border border-[#1677ed]'
                        : 'bg-white text-[#354c75] border border-[#dce7f3] hover:bg-blue-50/70 hover:text-[#1677ed]'
                    }`}
                  >
                    <span>{name}반</span>
                    <span className={`text-[11px] font-normal ${isCurrent ? 'text-white/80' : 'text-[#58708f]'}`}>
                      ({classStudents.length})
                    </span>
                    {integratedCount > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold flex items-center gap-0.5 ${
                        isCurrent
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      }`}>
                        🌿통합(-{reductionCount * integratedCount})
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              oldClassNumbers.map(classNum => {
                const count = allAssignedStudents.filter(s => s.현학급 === classNum).length;
                const isCurrent = activeTab === String(classNum);
                return (
                  <button
                    key={classNum}
                    onClick={() => setActiveTab(String(classNum))}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 whitespace-nowrap cursor-pointer ${
                      isCurrent
                        ? 'bg-[#1677ed] text-white shadow-xs border border-[#1677ed]'
                        : 'bg-white text-[#354c75] border border-[#dce7f3] hover:bg-blue-50/70 hover:text-[#1677ed]'
                    }`}
                  >
                    <span>{classNum}반</span>
                    <span className={`text-[11px] font-normal ml-1 ${isCurrent ? 'text-white/80' : 'text-[#58708f]'}`}>
                      ({count})
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {onReset && (
            <div className="flex gap-2 ml-4">
              <button
                onClick={onReset}
                title="재배정 설정으로 돌아가기"
                className="p-2 rounded-xl bg-white border border-[#dce7f3] text-[#58708f] hover:text-[#1677ed] hover:bg-blue-50/70 cursor-pointer transition-colors shadow-xs"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* 탭 내용 */}
        <div className="p-4 sm:p-5">
          {activeTab === 'SPECIAL_DASHBOARD' ? (
            <div className="space-y-4">
              <div className="bg-white border border-[#dce7f3] rounded-2xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(20,65,120,0.04)]">
                <h4 className="text-base font-extrabold text-[#071747] flex flex-wrap items-center gap-2">
                  <span>📊 전교 반별 특이사항 분포 비교 매트릭스</span>
                </h4>
                <p className="text-xs text-[#58708f] mt-1">
                  가반부터 끝반까지 각 반에 특수학생, 생활지도, 부진, 운동부, 쌍둥이 등이 고루 균등 배정되었는지 한눈에 대조합니다.
                </p>

                <div className="mt-4 overflow-x-auto bg-white rounded-xl border border-[#dce7f3] shadow-xs">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr className="bg-[#f8fbff] border-b border-[#dce7f3] text-[#071747] font-bold">
                        <th className="py-2.5 px-3 border-r border-[#e2ecf7]">구분</th>
                        {result.activeClassNames.map(cls => (
                          <th key={cls} className="py-2.5 px-3 border-r border-[#e2ecf7]">{cls}반</th>
                        ))}
                        <th className="py-2.5 px-3 bg-[#edf4fc] font-extrabold text-[#071747]">합계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eef4fb] text-xs text-[#354c75]">
                      <tr>
                        <td className="py-2.5 px-3 font-bold bg-[#f8fbff] border-r border-[#e2ecf7] text-left text-[#071747]">총 배정 인원</td>
                        {result.activeClassNames.map(cls => (
                          <td key={cls} className="py-2.5 px-3 font-bold border-r border-[#e2ecf7] text-[#071747]">
                            {(result.assignments[cls] || []).length}명
                          </td>
                        ))}
                        <td className="py-2.5 px-3 font-extrabold bg-[#edf4fc] text-[#1677ed]">{allAssignedStudents.length}명</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold bg-emerald-50/40 border-r border-[#e2ecf7] text-emerald-900 text-left">
                          🌿 특수(통합)학생
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.통합학급).length;
                          return (
                            <td key={cls} className={`py-2.5 px-3 border-r border-[#e2ecf7] font-bold ${c > 0 ? 'bg-emerald-50/60 text-emerald-700' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 font-black bg-emerald-50/80 text-emerald-800">
                          {allAssignedStudents.filter(s => s.통합학급).length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold bg-rose-50/40 border-r border-[#e2ecf7] text-rose-900 text-left">
                          생활지도 '상'
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.생활지도 === '상').length;
                          return (
                            <td key={cls} className={`py-2.5 px-3 border-r border-[#e2ecf7] font-bold ${c > 0 ? 'bg-rose-50/60 text-rose-700' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 font-black bg-rose-50/80 text-rose-800">
                          {allAssignedStudents.filter(s => s.생활지도 === '상').length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold bg-amber-50/30 border-r border-[#e2ecf7] text-amber-900 text-left">
                          기초학력 부진
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.학습부진).length;
                          return (
                            <td key={cls} className={`py-2.5 px-3 border-r border-[#e2ecf7] font-bold ${c > 0 ? 'text-amber-800' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 font-black bg-amber-50/80 text-amber-900">
                          {allAssignedStudents.filter(s => s.학습부진).length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold bg-blue-50/30 border-r border-[#e2ecf7] text-[#1677ed] text-left">
                          운동부(학생선수)
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.학생선수).length;
                          return (
                            <td key={cls} className={`py-2.5 px-3 border-r border-[#e2ecf7] font-bold ${c > 0 ? 'text-[#1677ed]' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 font-black bg-blue-50/80 text-[#1677ed]">
                          {allAssignedStudents.filter(s => s.학생선수).length}명
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 특이사항 학생 전체 명렬표 */}
              <div className="mt-4">
                <h4 className="text-sm font-bold text-[#071747] mb-2">
                  📝 특이사항 대상 학생 전체 명렬표 ({displayedStudents.length}명)
                </h4>
                <ClassTable
                  students={displayedStudents}
                  showAssignedClass={true}
                  numberType={resultViewMode === 'oldClass' ? 'original' : 'assigned'}
                  activeClassNames={result.activeClassNames}
                  onClassChange={!isReadOnly ? handleStudentClassChange : undefined}
                  onSelectSwap={!isReadOnly ? handleSelectSwap : undefined}
                  swapCandidate={swapCandidate}
                />
              </div>
            </div>
          ) : (
            /* 일반 반별 뷰 */
            <ClassTable
              students={displayedStudents}
              showAssignedClass={true}
              numberType={resultViewMode === 'oldClass' ? 'original' : 'assigned'}
              activeClassNames={result.activeClassNames}
              onClassChange={!isReadOnly ? handleStudentClassChange : undefined}
              onSelectSwap={!isReadOnly ? handleSelectSwap : undefined}
              swapCandidate={swapCandidate}
            />
          )}
        </div>

        {/* 엑셀 다운로드 바 */}
        <div className="p-4 sm:p-5 bg-[#f8fbff] border-t border-[#dce7f3] flex flex-wrap justify-end items-center gap-3">
          <button
            onClick={() => downloadResultsByNewClass(allAssignedStudents, result.assignments)}
            className="px-4 py-2.5 bg-[#1677ed] hover:bg-[#1260c4] text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center cursor-pointer"
          >
            <Download className="w-4 h-4 mr-2" />
            배정 학급 기준 명렬표 다운로드
          </button>
          <button
            onClick={() => downloadResultsByOldClass(allAssignedStudents)}
            className="px-4 py-2.5 bg-white hover:bg-blue-50/70 border border-[#dce7f3] hover:border-blue-200 text-[#1677ed] rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex items-center cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            기존 학급 기준 명렬표 다운로드
          </button>
        </div>
      </div>
    </div>
  );
};
