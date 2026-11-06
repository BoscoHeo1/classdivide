import { Student } from '../types';

export interface ProportionalTargets {
  genderTargets: Record<string, { male: number; female: number }>;
  originTargets: Record<string, Record<number, number>>;
}

// 이름·특이사항을 사용하지 않고 총원, 기존 반, 성별만으로 정수 목표표를 먼저 만듭니다.
export const calculateProportionalTargets = (
  students: Student[], names: string[], targets: Record<string, number>
): ProportionalTargets => {
  if (students.some(s => s.성별 !== '남성' && s.성별 !== '여성')) {
    throw new Error('성별이 비어 있거나 인식되지 않는 학생이 있습니다. 엑셀의 성별을 남성·여성으로 확인해주세요.');
  }
  const total = students.length;
  const origins = [...new Set(students.map(s => s.현학급))].sort((a, b) => a - b);
  const counts = origins.map(origin => [
    students.filter(s => s.현학급 === origin && s.성별 === '남성').length,
    students.filter(s => s.현학급 === origin && s.성별 === '여성').length
  ]);
  const maleTotal = counts.reduce((sum, row) => sum + row[0], 0);
  const maleTargets = names.map(name => total ? Math.floor(targets[name] * maleTotal / total) : 0);
  const roundingOrder = names.map((name, j) => ({ j, remainder: total ? targets[name] * maleTotal % total : 0 }))
    .sort((a, b) => b.remainder - a.remainder || a.j - b.j);
  const extra = maleTotal - maleTargets.reduce((sum, value) => sum + value, 0);
  roundingOrder.slice(0, extra).forEach(({ j }) => maleTargets[j]++);
  const genderTargets = Object.fromEntries(names.map((name, j) => [name,
    { male: maleTargets[j], female: targets[name] - maleTargets[j] }]));
  const slots = [maleTargets.slice(), names.map((name, j) => targets[name] - maleTargets[j])];
  const used = origins.map(() => names.map(() => 0));
  const remaining = counts.map(row => row.slice());
  const lower = counts.map(row => names.map(name => Math.floor((row[0] + row[1]) * targets[name] / total)));
  const upper = counts.map(row => names.map(name => Math.ceil((row[0] + row[1]) * targets[name] / total)));
  let attempts = 0;
  let timedOut = false;
  const deadline = Date.now() + 1500;

  // 남녀 합계와 기존 반 합계를 동시에 지키며 각 칸은 비례값의 내림·올림 범위 안에 둡니다.
  const search = (left: number): boolean => {
    if (!left) return used.every((row, i) => row.every((count, j) => count >= lower[i][j] && count <= upper[i][j]));
    if (++attempts > 50000 || Date.now() > deadline) { timedOut = true; return false; }
    let selectedOrigin = -1, selectedGender = -1;
    let bestOptions = Infinity, bestPressure = -1;
    for (let i = 0; i < origins.length; i++) {
      const originLeft = remaining[i][0] + remaining[i][1];
      const required = names.reduce((sum, _, j) => sum + Math.max(0, lower[i][j] - used[i][j]), 0);
      const available = names.reduce((sum, _, j) => sum + upper[i][j] - used[i][j], 0);
      if (required > originLeft || available < originLeft) return false;
      for (let gender = 0; gender < 2; gender++) {
        if (!remaining[i][gender]) continue;
        const possible = names.map((_, j) => Math.min(slots[gender][j], upper[i][j] - used[i][j]));
        const capacity = possible.reduce((sum, value) => sum + value, 0);
        if (capacity < remaining[i][gender]) return false;
        const options = possible.filter(value => value > 0).length;
        const pressure = remaining[i][gender] / capacity;
        if (options < bestOptions || (options === bestOptions && pressure > bestPressure)) {
          selectedOrigin = i; selectedGender = gender; bestOptions = options; bestPressure = pressure;
        }
      }
    }
    for (let j = 0; j < names.length; j++) {
      const required = origins.reduce((sum, _, i) => sum + Math.max(0, lower[i][j] - used[i][j]), 0);
      if (required > slots[0][j] + slots[1][j]) return false;
      for (let gender = 0; gender < 2; gender++) {
        const available = origins.reduce((sum, _, i) => sum + Math.min(remaining[i][gender], upper[i][j] - used[i][j]), 0);
        if (available < slots[gender][j]) return false;
      }
    }
    const i = selectedOrigin, gender = selectedGender;
    const ideal = names.map(name => (counts[i][0] + counts[i][1]) * targets[name] / total);
    const candidates = names.map((_, j) => j).filter(j => slots[gender][j] > 0 && used[i][j] < upper[i][j]);
    candidates.sort((a, b) => (used[i][a] - ideal[a]) - (used[i][b] - ideal[b]) ||
      slots[gender][b] / Math.max(1, gender === 0 ? maleTargets[b] : targets[names[b]] - maleTargets[b]) -
      slots[gender][a] / Math.max(1, gender === 0 ? maleTargets[a] : targets[names[a]] - maleTargets[a]) || a - b);
    for (const j of candidates) {
      remaining[i][gender]--; used[i][j]++; slots[gender][j]--;
      if (search(left - 1)) return true;
      remaining[i][gender]++; used[i][j]--; slots[gender][j]++;
      if (timedOut) return false;
    }
    return false;
  };
  if (total && !search(total)) throw new Error(timedOut
    ? '남녀·기존 학급 비례 목표를 제한 시간 안에 계산하지 못했습니다. 학급 수와 입력을 확인해주세요.'
    : '남녀·기존 학급 비례 목표의 조합을 만들지 못했습니다. 학급 수와 입력을 확인해주세요.');
  const originTargets = Object.fromEntries(names.map((name, j) => [name,
    Object.fromEntries(origins.map((origin, i) => [origin, used[i][j]]))]));
  return { genderTargets, originTargets };
};

// 남은 남학생의 기존 반·새 학급별 배정이 가능한지 확인해 막힌 탐색을 일찍 중단합니다.
export const canCompleteGender = (originCapacity: number[][], maleByOrigin: number[], maleByClass: number[]): boolean => {
  const total = maleByOrigin.reduce((sum, value) => sum + value, 0);
  if (total !== maleByClass.reduce((sum, value) => sum + value, 0)) return false;
  if (!total) return true;
  const originCount = maleByOrigin.length, classCount = maleByClass.length;
  const source = originCount + classCount, sink = source + 1;
  const graph: { to: number; reverse: number; capacity: number }[][] = Array.from({ length: sink + 1 }, () => []);
  const edge = (from: number, to: number, capacity: number) => {
    graph[from].push({ to, capacity, reverse: graph[to].length });
    graph[to].push({ to: from, capacity: 0, reverse: graph[from].length - 1 });
  };
  maleByOrigin.forEach((capacity, i) => { edge(source, i, capacity); originCapacity[i].forEach((value, j) => edge(i, originCount + j, value)); });
  maleByClass.forEach((capacity, j) => edge(originCount + j, sink, capacity));
  let flow = 0;
  while (flow < total) {
    const parent = Array(graph.length).fill(-1), chosen = Array(graph.length).fill(-1);
    const queue = [source]; parent[source] = source;
    for (let q = 0; q < queue.length && parent[sink] === -1; q++) {
      const node = queue[q];
      graph[node].forEach((item, index) => { if (item.capacity > 0 && parent[item.to] === -1) {
        parent[item.to] = node; chosen[item.to] = index; queue.push(item.to);
      } });
    }
    if (parent[sink] === -1) return false;
    let amount = total - flow;
    for (let node = sink; node !== source; node = parent[node]) amount = Math.min(amount, graph[parent[node]][chosen[node]].capacity);
    for (let node = sink; node !== source; node = parent[node]) {
      const item = graph[parent[node]][chosen[node]]; item.capacity -= amount; graph[node][item.reverse].capacity += amount;
    }
    flow += amount;
  }
  return true;
};
