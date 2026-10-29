import { Student, ClassSettings, PlacementResult } from '../types';
import { placeWithinCapacity } from './capacityPlacement';

const CLASS_NAMES = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];

export const runPlacementAlgorithm = (
  rawStudents: Student[],
  settings: ClassSettings
): PlacementResult => {
  // Deep copy students
  const students = JSON.parse(JSON.stringify(rawStudents)) as Student[];
  const { nextClassCount } = settings;
  const activeClassNames = CLASS_NAMES.slice(0, nextClassCount);

  // --- Build Conflict Map (Separation Logic) & Together Map (Same Class Logic) ---
  const conflictMap = new Map<number, Set<number>>();
  const togetherMap = new Map<number, Set<number>>();
  
  const addConflict = (id1: number, id2: number) => {
    if (!conflictMap.has(id1)) conflictMap.set(id1, new Set());
    if (!conflictMap.has(id2)) conflictMap.set(id2, new Set());
    conflictMap.get(id1)!.add(id2);
    conflictMap.get(id2)!.add(id1);
  };

  const addTogether = (id1: number, id2: number) => {
    if (!togetherMap.has(id1)) togetherMap.set(id1, new Set());
    if (!togetherMap.has(id2)) togetherMap.set(id2, new Set());
    togetherMap.get(id1)!.add(id2);
    togetherMap.get(id2)!.add(id1);
  };

  // 1. Twins Logic
  // 🌟 settings.twinGroups가 명시적으로 지정된 경우: 생년월일/이름/성씨 추정 완전 배제, 명시적 그룹 ID 쌍만 반영
  if (settings.twinGroups && settings.twinGroups.length > 0) {
    settings.twinGroups.forEach(group => {
      const ids = group.studentIds || [];
      if (ids.length < 2) return;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (group.option === '동일') {
            addTogether(ids[i], ids[j]);
          } else {
            addConflict(ids[i], ids[j]);
          }
        }
      }
    });
  } else {
    // 기존 단독 모드 등 twinGroups가 전달되지 않았을 때의 하위 호환 로직
    const twinsByDob: Record<string, Student[]> = {};
    students.filter(s => s.쌍둥이).forEach(s => {
      const key = s.생년월일 || 'unknown';
      if (!twinsByDob[key]) twinsByDob[key] = [];
      twinsByDob[key].push(s);
    });
    Object.values(twinsByDob).forEach(group => {
      if (group.length > 1) {
        // 그룹 중 '동일'(같은 반) 희망이 있는지 확인
        const wantSameClass = group.some(s => s.쌍둥이옵션 === '동일');

        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            if (wantSameClass) {
              addTogether(group[i].id, group[j].id);
            } else {
              addConflict(group[i].id, group[j].id);
            }
          }
        }
      }
    });
  }

  // 2. Separation Request Logic
  const studentLookup: Record<string, Student[]> = {};
  students.forEach(s => {
    if (!studentLookup[s.이름]) studentLookup[s.이름] = [];
    studentLookup[s.이름].push(s);
  });

  students.forEach(s => {
    if (s.분리배정) {
      const requests = s.분리배정.split(/[,/]/).map(r => r.trim()).filter(r => r);
      requests.forEach(req => {
        const match = req.match(/(\d+)?\s*반?\s*(.+)/);
        if (match) {
            const targetClassStr = match[1];
            const targetName = match[2].trim();
            const candidates = studentLookup[targetName];

            if (candidates && candidates.length > 0) {
                let targetId: number | null = null;
                if (targetClassStr) {
                    const targetClass = parseInt(targetClassStr);
                    const specific = candidates.find(c => c.현학급 === targetClass);
                    if (specific) targetId = specific.id;
                } else {
                    if (candidates.length === 1) {
                        targetId = candidates[0].id;
                    } else {
                         candidates.forEach(c => {
                             if (c.id !== s.id) addConflict(s.id, c.id);
                         });
                         return; 
                    }
                }
                if (targetId && targetId !== s.id) {
                    addConflict(s.id, targetId);
                }
            }
        }
      });
    }
  });

  return placeWithinCapacity(students, settings, activeClassNames, conflictMap, togetherMap);
};
