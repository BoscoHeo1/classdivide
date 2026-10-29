import { Student, ClassSettings, PlacementResult } from '../types';

// 목표 인원은 전출 예정자도 포함한 화면 표시 총원으로 계산한다.
export const placeWithinCapacity = (
  students: Student[], settings: ClassSettings, names: string[],
  conflicts: Map<number, Set<number>>, together: Map<number, Set<number>>
): PlacementResult => {
  const { normalCapacity, reductionCount } = settings;
  if (!Number.isInteger(settings.nextClassCount) || settings.nextClassCount < 1 || settings.nextClassCount > 14 ||
      !Number.isInteger(normalCapacity) || normalCapacity < 1 ||
      !Number.isInteger(reductionCount) || reductionCount < 0) {
    throw new Error('학급 수는 1~14, 기준 인원은 1 이상, 감축 인원은 0 이상의 정수로 입력해주세요.');
  }
  if (new Set(students.map(s => s.id)).size !== students.length) throw new Error('학생 식별자가 중복되어 배정할 수 없습니다.');
  students.forEach(s => { delete s.배정학급; delete s.출석번호; });

  // 같은 반 요청의 연결 관계를 묶어, 형제·자매를 한 단위로 배정한다.
  const byId = new Map(students.map(s => [s.id, s]));
  const seen = new Set<number>();
  const groups: Student[][] = [];
  for (const student of students) {
    if (seen.has(student.id)) continue;
    const group: Student[] = [];
    const pending = [student.id];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id) || !byId.has(id)) continue;
      seen.add(id);
      group.push(byId.get(id)!);
      for (const partner of together.get(id) || []) pending.push(partner);
    }
    if (group.some(a => group.some(b => a.id !== b.id &&
      (conflicts.get(a.id)?.has(b.id) || a.이름 === b.이름)))) {
      throw new Error('같은 반 요청과 분리 요청 또는 동명이인 분리 조건이 충돌합니다. 요청을 확인해주세요.');
    }
    groups.push(group);
  }
  const isIntegrated = (g: Student[]) => g.some(s => s.통합학급);
  const integratedCount = Math.min(names.length, groups.filter(isIntegrated).length);
  const integratedClasses = names.slice(0, integratedCount);
  const normalClasses = names.slice(integratedCount);
  const appliedReduction = normalClasses.length ? reductionCount : 0;
  const weightedTotal = students.length + integratedCount * appliedReduction;
  const effectiveNormalCapacity = Math.floor(weightedTotal / names.length);
  const remainder = weightedTotal % names.length;
  const targets: Record<string, number> = {};
  names.forEach(name => { targets[name] = effectiveNormalCapacity - (integratedClasses.includes(name) ? appliedReduction : 0); });
  // 나머지는 일반학급부터 배정해 통합학급 감축 차이가 줄어들지 않게 한다.
  [...normalClasses, ...integratedClasses].slice(0, remainder).forEach(name => targets[name]++);
  if (names.some(name => targets[name] < 0) || integratedClasses.some(name => targets[name] < 1)) {
    throw new Error('현재 학생 수와 학급 수로는 요청한 통합학급 감축 차이를 유지할 수 없습니다. 학급 수나 감축 인원을 조정해주세요.');
  }
  const targetText = names.map(name => `${name}반 ${targets[name]}명`).join(', ');
  const message = `입력 기준 ${normalCapacity}명 → 총 ${students.length}명에 맞춘 일반학급 기본 인원 ${effectiveNormalCapacity}명. ` +
    (normalClasses.length ? `통합학급은 학급당 ${reductionCount}명 감축하며, 나머지 인원은 일반학급부터 배정합니다. ` : '일반학급이 없어 학급 간 인원을 균등하게 배정합니다. ') + targetText;
  const capacityPlan = { targets, integratedClasses, requestedNormalCapacity: normalCapacity, effectiveNormalCapacity, reductionCount, message };
  const assignments: Record<string, Student[]> = Object.fromEntries(names.map(name => [name, []]));

  const priority = (g: Student[]) => g.reduce((n, s) => n + (s.생활지도 === '상' ? 8 : 0) +
    (s.학생선수 ? 4 : 0) + (s.학습부진 ? 2 : 0) + (s.학부모민원 ? 1 : 0), 0);
  const degree = (g: Student[]) => g.reduce((n, s) => n + (conflicts.get(s.id)?.size || 0), 0);
  groups.sort((a, b) => Number(isIntegrated(b)) - Number(isIntegrated(a)) ||
    b.length - a.length || degree(b) - degree(a) || priority(b) - priority(a) ||
    a[0].현학급 - b[0].현학급 || String(a[0].생년월일).localeCompare(String(b[0].생년월일)) || a[0].id - b[0].id);

  const canPlace = (group: Student[], name: string) => {
    const list = assignments[name];
    if (list.length + group.length > targets[name]) return false;
    if (isIntegrated(group) && !integratedClasses.includes(name)) return false;
    return group.every(s => list.every(other => !conflicts.get(s.id)?.has(other.id) && s.이름 !== other.이름));
  };
  const score = (group: Student[], name: string) => {
    const list = assignments[name];
    // 출신반·성별 등은 목표 인원과 분리 조건을 지킨 후보 사이에서 균형을 맞춘다.
    let originPenalty = 0;
    for (const s of group) {
      const origin = list.filter(o => o.현학급 === s.현학급);
      originPenalty += Math.max(0, origin.length + group.filter(o => o.현학급 === s.현학급).length - 4) * 10;
      originPenalty += Math.max(0, origin.filter(o => o.성별 === s.성별).length + group.filter(o => o.현학급 === s.현학급 && o.성별 === s.성별).length - 2) * 10;
    }
    const categoryLoad = group.reduce((n, s) => n + (s.생활지도 === '상' && integratedClasses.includes(name) ? 2 : 0) + list.filter(o =>
      (s.생활지도 === '상' && o.생활지도 === '상') || (s.학생선수 && o.학생선수) ||
      (s.학습부진 && o.학습부진) || (s.학부모민원 && o.학부모민원)).length, 0);
    const genderLoad = group.reduce((n, s) => n + list.filter(o => o.성별 === s.성별).length, 0);
    const emptyIntegrated = isIntegrated(group) && !list.some(s => s.통합학급) ? -100000 : 0;
    return emptyIntegrated + originPenalty * 100 + categoryLoad * 5 +
      list.length / Math.max(1, targets[name]) * 20 + genderLoad;
  };

  // 조건이 막히면 앞선 배정을 되돌려 탐색한다. 해결되지 않은 결과를 성공으로 반환하지 않는다.
  let attempts = 0;
  const limit = 150000;
  const deadline = Date.now() + 4000;
  let exhausted = false;
  const search = (index: number): boolean => {
    if (index === groups.length) return integratedClasses.every(name => assignments[name].some(s => s.통합학급));
    if (++attempts > limit || Date.now() > deadline) { exhausted = true; return false; }
    const group = groups[index];
    let candidates = names.filter(name => canPlace(group, name));
    if (isIntegrated(group)) {
      const empty = integratedClasses.filter(name => !assignments[name].some(s => s.통합학급));
      const remaining = groups.slice(index).filter(isIntegrated).length;
      if (remaining === empty.length) candidates = candidates.filter(name => empty.includes(name));
    }
    candidates.sort((a, b) => score(group, a) - score(group, b));
    for (const name of candidates) {
      assignments[name].push(...group);
      if (search(index + 1)) return true;
      assignments[name].splice(assignments[name].length - group.length, group.length);
      if (exhausted) return false;
    }
    return false;
  };
  if (!search(0)) throw new Error(exhausted
    ? '목표 인원과 분리·같은 반 요청을 함께 만족하는 배정을 제한 시간 안에 찾지 못했습니다. 요청을 확인하고 다시 실행해주세요.'
    : '목표 인원과 분리·같은 반 요청을 함께 만족할 수 없습니다. 학급 수나 배정 요청을 조정해주세요.');

  for (const name of names) {
    assignments[name].sort((a, b) => Number(a.전출예정) - Number(b.전출예정) || a.이름.localeCompare(b.이름, 'ko'));
    assignments[name].forEach((s, i) => { s.배정학급 = name; s.출석번호 = i + 1; });
  }
  const all = Object.values(assignments).flat();
  const result: PlacementResult = {
    assignments, activeClassNames: names, capacityPlan,
    stats: {
      totalStudents: all.length, totalMale: all.filter(s => s.성별 === '남성').length,
      totalFemale: all.filter(s => s.성별 === '여성').length, duplicates: all.filter(s => s.동명이인).length,
      highGuidance: all.filter(s => s.생활지도 === '상').length, integrated: all.filter(s => s.통합학급).length,
      underachieving: all.filter(s => s.학습부진).length, athletes: all.filter(s => s.학생선수).length,
      parentComplaints: all.filter(s => s.학부모민원).length
    }
  };
  const violation = getCapacityViolation(result, assignments);
  if (all.length !== students.length || new Set(all.map(s => s.id)).size !== students.length || violation) {
    throw new Error(violation || '학생 누락 또는 중복이 있어 배정 결과를 확정하지 않았습니다.');
  }
  return result;
};

// 수동 이동·맞교환도 확정된 인원 계획과 통합학급 구분을 유지해야 한다.
export const getCapacityViolation = (result: PlacementResult, assignments: Record<string, Student[]>): string | null => {
  const plan = result.capacityPlan;
  if (!plan) return null;
  for (const name of result.activeClassNames) {
    const list = assignments[name] || [];
    if (list.length !== plan.targets[name]) return `${name}반 목표 ${plan.targets[name]}명을 유지해야 합니다. 한 명 이동 대신 학생 맞교환을 이용해주세요.`;
    if (list.some(s => s.통합학급) !== plan.integratedClasses.includes(name)) return '통합학급 구분이 변경되어 감축 인원이 맞지 않습니다. 설정에서 다시 편성해주세요.';
  }
  return null;
};
