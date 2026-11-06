import React from 'react';
import { PlacementResult, Student } from '../types';

export const ProportionalSummary: React.FC<{ result: PlacementResult }> = ({ result }) => {
  const plan = result.capacityPlan;
  if (!plan) return null;
  if (!plan.genderTargets || !plan.originTargets) return (
    <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      이전 기준으로 만든 결과입니다. 남녀·기존 학급 비례 목표를 적용하려면 설정에서 다시 편성해주세요.
    </p>
  );
  const origins = [...new Set(Object.values(plan.originTargets).flatMap(row => Object.keys(row)))].map(Number).sort((a, b) => a - b);
  const all = Object.values<Student[]>(result.assignments).flat();
  const male = all.filter(s => s.성별 === '남성').length;
  const maleRatio = all.length ? (male / all.length * 100).toFixed(1) : '0.0';
  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-4 space-y-3" aria-label="비례 배정 목표와 실제 인원">
      <h3 className="font-bold text-slate-900">새 학급별 목표 / 실제 인원</h3>
      <p className="text-xs leading-5 text-slate-600">
        전체 남 {male}명·여 {all.length - male}명(남 {maleRatio}%)을 기준으로 학급별 남녀 목표를 계산했습니다.
        기존 반 인원도 새 학급 총원에 비례해 나누고 전체 합계를 맞췄습니다. 정수 인원으로 나누므로 비율이 완전히 같지 않을 수 있습니다.
        맞교환할 때에도 이 목표를 유지합니다. 표가 넓으면 좌우로 밀어 확인하세요.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs whitespace-nowrap text-center">
          <caption className="sr-only">각 칸은 목표 인원과 실제 인원 순서입니다.</caption>
          <thead className="bg-blue-50 text-blue-900"><tr>
            <th scope="col" className="p-2">새 학급</th><th scope="col" className="p-2">총원</th>
            <th scope="col" className="p-2">남</th><th scope="col" className="p-2">여</th>
            {origins.map(origin => <th scope="col" className="p-2" key={origin}>기존 {origin}반</th>)}
          </tr></thead>
          <tbody>{result.activeClassNames.map(name => {
            const rows = result.assignments[name] || [];
            const counts = [
              [plan.targets[name], rows.length],
              [plan.genderTargets![name].male, rows.filter(s => s.성별 === '남성').length],
              [plan.genderTargets![name].female, rows.filter(s => s.성별 === '여성').length],
              ...origins.map(origin => [plan.originTargets![name][origin] || 0, rows.filter(s => s.현학급 === origin).length])
            ];
            return <tr key={name} className="border-t border-slate-100"><th scope="row" className="p-2">{name}반</th>
              {counts.map(([target, actual], index) => <td key={index} className={'p-2 ' + (target === actual ? 'text-slate-700' : 'font-bold text-red-700')}>{target} / {actual}</td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
};
