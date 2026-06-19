import React from 'react';
import { Student } from '../types';

interface ClassTableProps {
  students: Student[];
  showAssignedClass?: boolean;
}

const ClassTable: React.FC<ClassTableProps> = ({ students, showAssignedClass = false }) => {
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
      return (
          <div className="flex flex-wrap gap-1">
              {s.동명이인 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('danger')}`}>동명이인</span>}
              {s.전출예정 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('danger')}`}>전출예정</span>}
              {s.학습부진 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('warning')}`}>학습부진</span>}
              {s.생활지도 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.생활지도 === '상' ? getBadgeColor('danger') : getBadgeColor('warning')}`}>생활({s.생활지도})</span>}
              {s.학생선수 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('special')}`}>학생선수</span>}
              {s.통합학급 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('success')}`}>통합학급</span>}
              {s.학부모민원 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('warning')}`}>민원</span>}
              {s.쌍둥이 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('danger')}`}>쌍둥이</span>}
              {s.분리배정 && <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBadgeColor('special')}`}>분리요청</span>}
          </div>
      );
  };

  return (
    <div className="overflow-x-auto border rounded-lg shadow-sm max-h-[600px] overflow-y-auto bg-white">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-white uppercase bg-indigo-600 sticky top-0 z-10">
          <tr>
            <th className="px-4 py-3 w-16">번호</th>
            <th className="px-4 py-3 w-32">이름</th>
            <th className="px-4 py-3 w-20">성별</th>
            <th className="px-4 py-3 w-32">생년월일</th>
            <th className="px-4 py-3 w-24">이전반</th>
            {showAssignedClass && <th className="px-4 py-3 w-24">배정반</th>}
            <th className="px-4 py-3">특이사항</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {students.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-2 font-medium text-gray-900">{s.출석번호 || '-'}</td>
              <td className="px-4 py-2 font-medium text-gray-900">{s.이름}</td>
              <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${s.성별 === '남성' ? getBadgeColor('male') : getBadgeColor('female')}`}>
                      {s.성별}
                  </span>
              </td>
              <td className="px-4 py-2 text-gray-500">{s.생년월일 || '-'}</td>
              <td className="px-4 py-2 text-gray-500">{s.현학급}반</td>
              {showAssignedClass && (
                  <td className="px-4 py-2 font-bold text-indigo-600">{s.배정학급}반</td>
              )}
              <td className="px-4 py-2">
                  <SpecialBadges s={s} />
              </td>
            </tr>
          ))}
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