import React from 'react';
import { Student } from '../types';

interface ClassTableProps {
  students: Student[];
  showAssignedClass?: boolean;
  numberType?: 'assigned' | 'original';
  activeClassNames?: string[];
  onClassChange?: (studentId: number, newClassName: string) => void;
  onSelectSwap?: (student: Student) => void;
  swapCandidate?: Student | null;
}

const ClassTable: React.FC<ClassTableProps> = ({ 
  students, 
  showAssignedClass = false, 
  numberType = 'assigned',
  activeClassNames,
  onClassChange,
  onSelectSwap,
  swapCandidate
}) => {
  const getBadgeColor = (type: string, val?: string) => {
      switch(type) {
          case 'male': return 'bg-blue-100 text-blue-700';
          case 'female': return 'bg-pink-100 text-pink-700';
          case 'special': return 'bg-amber-100 text-amber-800';
          case 'danger': return 'bg-red-100 text-red-700';
          case 'success': return 'bg-emerald-100 text-emerald-700';
          case 'warning': return 'bg-orange-100 text-orange-800';
          default: return 'bg-gray-100 text-gray-700';
      }
  };

  const SpecialBadges = ({ s }: { s: Student }) => {
      const hasAnyBadge = s.동명이인 || s.전출예정 || s.학습부진 || s.생활지도 || s.학생선수 || s.통합학급 || s.학부모민원 || s.쌍둥이 || s.분리배정;
      
      if (!hasAnyBadge) {
          return <span className="text-gray-400 text-xs">-</span>;
      }

      return (
          <div className="flex flex-wrap gap-1">
              {s.동명이인 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('danger')}`}>동명이인</span>}
              {s.전출예정 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('danger')}`}>전출예정</span>}
              {s.학습부진 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('warning')}`}>학습부진</span>}
              {s.생활지도 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.생활지도 === '상' ? getBadgeColor('danger') : getBadgeColor('warning')}`}>생활({s.생활지도})</span>}
              {s.학생선수 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('special')}`}>학생선수</span>}
              {s.통합학급 && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-600 text-white shadow-sm flex items-center gap-1" title="특수교육대상자 (통합학급 배정 - 정원 감축 적용)">
                      <span>🌿</span>
                      <span>특수(통합)</span>
                  </span>
              )}
              {s.학부모민원 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('warning')}`}>민원</span>}
              {s.쌍둥이 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.쌍둥이옵션 === '동일' ? 'bg-purple-100 text-purple-700 border border-purple-200' : getBadgeColor('danger')}`}>
                      쌍둥이({s.쌍둥이옵션 === '동일' ? '같은반' : '분리'})
                  </span>
              )}
              {s.분리배정 && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('special')}`} title={`분리요청: ${s.분리배정}`}>
                      분리({s.분리배정})
                  </span>
              )}
          </div>
      );
  };

  return (
    <div className="overflow-x-auto border rounded-lg shadow-sm max-h-[600px] overflow-y-auto bg-white">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-white uppercase bg-indigo-600 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 w-16">번호</th>
            <th className="px-4 py-3 w-28">이름</th>
            <th className="px-4 py-3 w-20">성별</th>
            <th className="px-4 py-3 w-28">생년월일</th>
            <th className="px-4 py-3 w-20">이전반</th>
            {showAssignedClass && <th className="px-4 py-3 w-48">배정반 (조정)</th>}
            <th className="px-4 py-3">특이사항</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {students.map((s) => {
            const isSwapSelected = swapCandidate?.id === s.id;
            const isIntegrated = s.통합학급;
            return (
              <tr 
                key={s.id} 
                className={`transition-colors ${
                  isSwapSelected 
                    ? 'bg-amber-100/80 ring-2 ring-amber-400 font-medium' 
                    : isIntegrated
                      ? 'bg-emerald-50/50 hover:bg-emerald-100/60'
                      : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-4 py-2 font-medium text-gray-900">{numberType === 'original' ? (s.번호 || '-') : (s.출석번호 || '-')}</td>
                <td className="px-4 py-2 font-medium text-gray-900 flex items-center gap-1.5">
                  <span>{s.이름}</span>
                  {s.통합학급 && (
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-extrabold border border-emerald-300" title="특수교육대상자">
                      🌿특수
                    </span>
                  )}
                  {isSwapSelected && (
                    <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                      교환선택됨
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${s.성별 === '남성' ? getBadgeColor('male') : getBadgeColor('female')}`}>
                        {s.성별}
                    </span>
                </td>
                <td className="px-4 py-2 text-gray-500">{s.생년월일 || '-'}</td>
                <td className="px-4 py-2 text-gray-500">{s.현학급}반</td>
                {showAssignedClass && (
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {onClassChange && activeClassNames && activeClassNames.length > 0 ? (
                          <select
                            value={s.배정학급 || ''}
                            onChange={(e) => onClassChange(s.id, e.target.value)}
                            className="px-2 py-1 bg-indigo-50/80 border border-indigo-300 rounded font-bold text-xs text-indigo-700 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                            title="클릭하여 배정반 변경"
                          >
                            {activeClassNames.map((name) => (
                              <option key={name} value={name}>
                                {name}반
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-bold text-indigo-600">{s.배정학급}반</span>
                        )}

                        {onSelectSwap && (
                          <button
                            type="button"
                            onClick={() => onSelectSwap(s)}
                            className={`px-2 py-1 rounded text-[11px] font-bold transition flex items-center gap-1 border ${
                              isSwapSelected
                                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                                : swapCandidate
                                  ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                            }`}
                            title={isSwapSelected ? '선택 취소' : swapCandidate ? `${swapCandidate.이름} 학생과 맞교환` : '1:1 맞교환 대상 선택'}
                          >
                            <span>🔄</span>
                            <span>{isSwapSelected ? '취소' : swapCandidate ? '맞교환' : '교환'}</span>
                          </button>
                        )}
                      </div>
                    </td>
                )}
                <td className="px-4 py-2">
                    <SpecialBadges s={s} />
                </td>
              </tr>
            );
          })}
          {students.length === 0 && (
              <tr>
                  <td colSpan={showAssignedClass ? 7 : 6} className="px-4 py-8 text-center text-gray-500">
                      표시할 학생 데이터가 없습니다.
                  </td>
              </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ClassTable;