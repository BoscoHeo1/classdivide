import React, { useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw, AlertTriangle, ArrowRight } from 'lucide-react';
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
  const allAssignedStudents: Student[] = Object.values(result.assignments).flat();

  // 기존 학급 번호 목록
  const oldClassNumbers = Array.from(new Set(allAssignedStudents.map(s => s.현학급))).sort((a, b) => a - b);

  // 현재 탭에 해당하는 학생 필터링
  let currentGroupStudents: Student[] = [];
  if (resultViewMode === 'newClass') {
    if (activeTab === 'ALL') {
      currentGroupStudents = allAssignedStudents;
    } else if (activeTab === 'SPECIAL_DASHBOARD') {
      currentGroupStudents = allAssignedStudents.filter(s =>
        s.통합학급 || (s.생활지도 && s.생활지도 !== '') || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      );
    } else {
      currentGroupStudents = result.assignments[activeTab] || [];
    }
  } else {
    if (activeTab === 'ALL') {
      currentGroupStudents = allAssignedStudents;
    } else if (activeTab === 'SPECIAL_DASHBOARD') {
      currentGroupStudents = allAssignedStudents.filter(s =>
        s.통합학급 || (s.생활지도 && s.생활지도 !== '') || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      );
    } else {
      const classNum = Number(activeTab);
      currentGroupStudents = allAssignedStudents.filter(s => s.현학급 === classNum);
    }
  }

  // 특이사항 체크 필터
  const displayedStudents = filterSpecialOnly
    ? currentGroupStudents.filter(s =>
        s.통합학급 || (s.생활지도 && s.생활지도 !== '') || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
      )
    : currentGroupStudents;

  // 특이사항 학생 총 수
  const totalSpecialCount = allAssignedStudents.filter(s =>
    s.통합학급 || (s.생활지도 && s.생활지도 !== '') || s.학습부진 || s.학생선수 || s.쌍둥이 || s.전출예정 || (s.분리배정 && s.분리배정 !== '')
  ).length;

  // 학생 수동 반 변경
  const handleStudentClassChange = (studentId: number, newClassName: string) => {
    if (isReadOnly || !onUpdateResult) return;

    let targetStudent: Student | null = null;
    let oldClass = '';

    for (const [cls, list] of Object.entries(result.assignments)) {
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

    const newAssignments = { ...result.assignments };
    newAssignments[c1] = newAssignments[c1].map(s => s.id === swapCandidate.id ? { ...s, 배정학급: c2 } : s);
    newAssignments[c2] = newAssignments[c2].map(s => s.id === student.id ? { ...s, 배정학급: c1 } : s);

    onUpdateResult({
      ...result,
      assignments: newAssignments
    });
    setSwapCandidate(null);
  };

  return (
    <div className="space-y-6">
      {/* 6대 핵심 지표 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl shadow-xs border border-indigo-100">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">총 학생</div>
          <div className="text-2xl font-black text-gray-900">{result.stats.totalStudents}명</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-xs border border-indigo-100">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">편성 학급</div>
          <div className="text-2xl font-black text-indigo-600">{result.activeClassNames.length}개 반</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-xs border border-indigo-100">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">생활지도 '상'</div>
          <div className="text-2xl font-black text-orange-500">{result.stats.highGuidance}명</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-xs border border-indigo-100">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">통합 학급</div>
          <div className="text-2xl font-black text-emerald-600">{result.stats.integrated}명</div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-xs border border-amber-100">
          <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">학습부진</div>
          <div className="text-2xl font-black text-amber-700">
            {result.stats.underachieving ?? allAssignedStudents.filter(s => s.학습부진).length}명
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-xs border border-blue-100">
          <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">운동부(선수)</div>
          <div className="text-2xl font-black text-blue-700">
            {result.stats.athletes ?? allAssignedStudents.filter(s => s.학생선수).length}명
          </div>
        </div>
      </div>

      {/* 보기 기준 전환 및 특이사항 필터 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white rounded-xl shadow-xs border border-indigo-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-gray-700 mr-1">보기 기준:</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-1 border border-gray-200">
            <button
              type="button"
              onClick={() => { setResultViewMode('newClass'); setActiveTab('ALL'); }}
              className={`px-4 py-2 rounded-md text-sm font-bold transition flex items-center gap-1.5 ${
                resultViewMode === 'newClass'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>🏫 배정반(새 학급) 기준</span>
            </button>
            <button
              type="button"
              onClick={() => { setResultViewMode('oldClass'); setActiveTab('ALL'); }}
              className={`px-4 py-2 rounded-md text-sm font-bold transition flex items-center gap-1.5 ${
                resultViewMode === 'oldClass'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>📋 기존반(현재 학급) 기준</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-bold text-gray-700 bg-amber-50 px-3.5 py-2 rounded-lg border border-amber-200 cursor-pointer hover:bg-amber-100 transition">
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
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between text-xs text-indigo-900 animate-pulse">
          <div className="flex items-center gap-2">
            <span className="font-bold">🔄 맞교환 대상 선택됨:</span>
            <span>[{swapCandidate.배정학급}반 {swapCandidate.이름}]</span>
            <span>➔ 맞교환할 다른 반 학생의 [🔄 맞교환] 버튼을 클릭하세요.</span>
          </div>
          <button
            onClick={() => setSwapCandidate(null)}
            className="px-2 py-1 bg-white border border-indigo-200 rounded-md font-bold hover:bg-indigo-100 text-indigo-700"
          >
            취소
          </button>
        </div>
      )}

      {/* 메인 탭 컨테이너 */}
      <div className="bg-white rounded-xl shadow-xs border border-indigo-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setActiveTab('ALL')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${
                activeTab === 'ALL' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              전체 보기 ({allAssignedStudents.length}명)
            </button>
            <button
              onClick={() => setActiveTab('SPECIAL_DASHBOARD')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap flex items-center gap-1.5 border ${
                activeTab === 'SPECIAL_DASHBOARD'
                  ? 'bg-amber-600 text-white border-amber-700 shadow-md ring-2 ring-amber-300'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
            >
              <span>⭐ 특이사항 종합 대시보드</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-extrabold ${
                activeTab === 'SPECIAL_DASHBOARD' ? 'bg-white text-amber-700' : 'bg-amber-200 text-amber-900'
              }`}>
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
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                      activeTab === name ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span>{name}반</span>
                    <span className="text-xs opacity-80 font-normal">({classStudents.length})</span>
                    {integratedCount > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold flex items-center gap-0.5 ${
                        activeTab === name
                          ? 'bg-emerald-400 text-emerald-950 ring-1 ring-white'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
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
                return (
                  <button
                    key={classNum}
                    onClick={() => setActiveTab(String(classNum))}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${
                      activeTab === String(classNum) ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {classNum}반 <span className="text-xs opacity-80 font-normal ml-1">({count})</span>
                  </button>
                );
              })
            )}
          </div>

          {onReset && (
            <div className="flex gap-2 ml-4">
              <button onClick={onReset} title="재배정 설정으로 돌아가기" className="p-2 text-gray-400 hover:text-gray-600 cursor-pointer">
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* 탭 내용 */}
        <div className="p-6">
          {activeTab === 'SPECIAL_DASHBOARD' ? (
            <div className="space-y-6">
              <div className="bg-amber-500/10 border border-amber-300 rounded-2xl p-5">
                <h4 className="text-base font-black text-amber-950 flex items-center gap-2">
                  <span>📊 전교 반별 특이사항 분포 비교 매트릭스</span>
                </h4>
                <p className="text-xs text-amber-800 mt-1">
                  가반부터 끝반까지 각 반에 특수학생, 생활지도, 부진, 운동부, 쌍둥이 등이 고루 균등 배정되었는지 한눈에 대조합니다.
                </p>

                <div className="mt-4 overflow-x-auto bg-white rounded-xl border border-amber-200 shadow-xs">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead>
                      <tr className="bg-amber-100/70 border-b border-amber-200 text-amber-950 font-bold">
                        <th className="py-2.5 px-3 border-r border-amber-200">구분</th>
                        {result.activeClassNames.map(cls => (
                          <th key={cls} className="py-2.5 px-3 border-r border-amber-200">{cls}반</th>
                        ))}
                        <th className="py-2.5 px-3 bg-amber-200/60 font-black">합계</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100 text-slate-700">
                      <tr>
                        <td className="py-2 px-3 font-bold bg-slate-50 border-r border-amber-100 text-left">총 배정 인원</td>
                        {result.activeClassNames.map(cls => (
                          <td key={cls} className="py-2 px-3 font-bold border-r border-amber-100">
                            {(result.assignments[cls] || []).length}명
                          </td>
                        ))}
                        <td className="py-2 px-3 font-black bg-slate-50">{allAssignedStudents.length}명</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold bg-emerald-50/50 border-r border-amber-100 text-emerald-900 text-left">
                          🌿 특수(통합)학생
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.통합학급).length;
                          return (
                            <td key={cls} className={`py-2 px-3 border-r border-amber-100 font-bold ${c > 0 ? 'bg-emerald-50 text-emerald-800' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 font-black bg-emerald-50 text-emerald-900">
                          {allAssignedStudents.filter(s => s.통합학급).length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold bg-orange-50/50 border-r border-amber-100 text-orange-900 text-left">
                          생활지도 '상'
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.생활지도 === '상').length;
                          return (
                            <td key={cls} className={`py-2 px-3 border-r border-amber-100 font-bold ${c > 0 ? 'bg-orange-50 text-orange-800' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 font-black bg-orange-50 text-orange-900">
                          {allAssignedStudents.filter(s => s.생활지도 === '상').length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold bg-amber-50/30 border-r border-amber-100 text-amber-900 text-left">
                          기초학력 부진
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.학습부진).length;
                          return (
                            <td key={cls} className={`py-2 px-3 border-r border-amber-100 font-bold ${c > 0 ? 'text-amber-800' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 font-black bg-amber-50 text-amber-900">
                          {allAssignedStudents.filter(s => s.학습부진).length}명
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold bg-blue-50/30 border-r border-amber-100 text-blue-900 text-left">
                          운동부(학생선수)
                        </td>
                        {result.activeClassNames.map(cls => {
                          const c = (result.assignments[cls] || []).filter(s => s.학생선수).length;
                          return (
                            <td key={cls} className={`py-2 px-3 border-r border-amber-100 font-bold ${c > 0 ? 'text-blue-800' : 'text-slate-400'}`}>
                              {c > 0 ? `${c}명` : '-'}
                            </td>
                          );
                        })}
                        <td className="py-2 px-3 font-black bg-blue-50 text-blue-900">
                          {allAssignedStudents.filter(s => s.학생선수).length}명
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 특이사항 학생 전체 명렬표 */}
              <div className="mt-6">
                <h4 className="text-sm font-bold text-gray-800 mb-2">
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
        <div className="p-6 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-center gap-4">
          <button
            onClick={() => downloadResultsByNewClass(result, allStudents)}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition flex items-center cursor-pointer"
          >
            <Download className="w-5 h-5 mr-2" />
            배정 학급 기준 명렬표 다운로드
          </button>
          <button
            onClick={() => downloadResultsByOldClass(result, allStudents)}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition flex items-center cursor-pointer"
          >
            <FileSpreadsheet className="w-5 h-5 mr-2" />
            기존 학급 기준 명렬표 다운로드
          </button>
        </div>
      </div>
    </div>
  );
};
