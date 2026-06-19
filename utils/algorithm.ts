import { Student, ClassSettings, PlacementResult } from '../types';

const CLASS_NAMES = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];

export const runPlacementAlgorithm = (
  rawStudents: Student[],
  settings: ClassSettings
): PlacementResult => {
  // Deep copy students
  const students = JSON.parse(JSON.stringify(rawStudents)) as Student[];
  const { nextClassCount, reductionCount, placementOrder, currentClassCount } = settings;
  const activeClassNames = CLASS_NAMES.slice(0, nextClassCount);

  // Constants for Constraints
  const MAX_ORIGIN_PER_CLASS = 4; // Max students from same previous class
  const MAX_ORIGIN_GENDER_PER_CLASS = 2; // Max students from same previous class AND same gender

  // Initialize Data Structures
  const classAssignments: Record<string, Student[]> = {};
  const hasIntegratedStudent: Record<string, boolean> = {};
  const classHighGuidanceCount: Record<string, number> = {}; 
  const classTransferCount: Record<string, number> = {};
  const classOriginCount: Record<string, Record<number, number>> = {}; 
  const classOriginGenderCount: Record<string, Record<string, number>> = {}; 

  activeClassNames.forEach(name => {
    classAssignments[name] = [];
    hasIntegratedStudent[name] = false;
    classHighGuidanceCount[name] = 0;
    classTransferCount[name] = 0;
    classOriginCount[name] = {};
    classOriginGenderCount[name] = {};
  });

  // --- Build Conflict Map (Separation Logic) ---
  const conflictMap = new Map<number, Set<number>>();
  
  const addConflict = (id1: number, id2: number) => {
    if (!conflictMap.has(id1)) conflictMap.set(id1, new Set());
    if (!conflictMap.has(id2)) conflictMap.set(id2, new Set());
    conflictMap.get(id1)!.add(id2);
    conflictMap.get(id2)!.add(id1);
  };

  // 1. Twins Logic
  const twinsByDob: Record<string, Student[]> = {};
  students.filter(s => s.쌍둥이).forEach(s => {
    const key = s.생년월일 || 'unknown';
    if (!twinsByDob[key]) twinsByDob[key] = [];
    twinsByDob[key].push(s);
  });
  Object.values(twinsByDob).forEach(group => {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          addConflict(group[i].id, group[j].id);
        }
      }
    }
  });

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

  // --- Helper Functions ---

  const hasSameNameInClass = (student: Student, className: string) => {
    if (!student.동명이인) return false;
    return classAssignments[className].some(s => s.이름 === student.이름 && s.id !== student.id);
  };

  const hasConflictInClass = (student: Student, className: string) => {
    const conflicts = conflictMap.get(student.id);
    if (!conflicts) return false;
    return classAssignments[className].some(s => conflicts.has(s.id));
  };

  const trackAssignment = (student: Student, className: string) => {
    // 1. Origin Total Count
    if (!classOriginCount[className][student.현학급]) {
        classOriginCount[className][student.현학급] = 0;
    }
    classOriginCount[className][student.현학급]++;

    // 2. Origin Gender Count
    const key = `${student.현학급}_${student.성별}`;
    if (!classOriginGenderCount[className][key]) {
        classOriginGenderCount[className][key] = 0;
    }
    classOriginGenderCount[className][key]++;

    // 3. High Guidance
    if (student.생활지도 === '상') {
        classHighGuidanceCount[className]++;
    }

    // 4. Transfer
    if (student.전출예정) {
        classTransferCount[className]++;
    }
  };

  const checkOriginConstraints = (student: Student, className: string) => {
      // Check Total Origin Limit (Max 4)
      const originTotal = classOriginCount[className][student.현학급] || 0;
      if (originTotal >= MAX_ORIGIN_PER_CLASS) return false;

      // Check Origin Gender Limit (Max 2)
      const key = `${student.현학급}_${student.성별}`;
      const originGender = classOriginGenderCount[className][key] || 0;
      if (originGender >= MAX_ORIGIN_GENDER_PER_CLASS) return false;

      return true;
  };

  const getSortByKoreanName = (a: Student, b: Student) => a.이름.localeCompare(b.이름, 'ko');

  const assignToClass = (student: Student, className: string) => {
    student.배정학급 = className;
    classAssignments[className].push(student);
    if (student.통합학급) hasIntegratedStudent[className] = true;
    trackAssignment(student, className);
  };

  // ** CORE LOGIC FOR EVEN DISTRIBUTION **
  const getVirtualLoad = (className: string) => {
      const count = classAssignments[className].length;
      const penalty = hasIntegratedStudent[className] ? reductionCount : 0;
      return count + penalty;
  };

  // Get gender count for balancing
  const getGenderCount = (className: string, gender: '남성'|'여성') => {
      return classAssignments[className].filter(s => s.성별 === gender).length;
  };

  // ==========================================
  // PHASE 1: Integrated Students
  // ==========================================
  const integratedStudents = students.filter(s => s.통합학급 && !s.전출예정);
  
  let integratedDistIndex = 0;
  integratedStudents.forEach(student => {
     let placed = false;
     for(let i=0; i<nextClassCount; i++) {
         const className = activeClassNames[(integratedDistIndex + i) % nextClassCount];
         if (!hasIntegratedStudent[className] && 
             !hasConflictInClass(student, className) &&
             checkOriginConstraints(student, className)) {
             assignToClass(student, className);
             placed = true;
             integratedDistIndex = (integratedDistIndex + i + 1);
             break;
         }
     }
     if(!placed) {
         for(let i=0; i<nextClassCount; i++) {
            const className = activeClassNames[(integratedDistIndex + i) % nextClassCount];
            if (!hasConflictInClass(student, className)) {
                assignToClass(student, className);
                placed = true;
                integratedDistIndex = (integratedDistIndex + i + 1);
                break;
            }
        }
     }
  });


  // ==========================================
  // PHASE 2 & 3: Priorities
  // ==========================================
  const priorityStudents = students.filter(s => 
      !s.배정학급 && !s.전출예정 && 
      (s.생활지도 === '상' || conflictMap.has(s.id) || s.학부모민원 || s.학습부진)
  );

  priorityStudents.sort((a, b) => {
      if (a.생활지도 === '상' && b.생활지도 !== '상') return -1;
      if (a.생활지도 !== '상' && b.생활지도 === '상') return 1;
      if (conflictMap.has(a.id) && !conflictMap.has(b.id)) return -1;
      if (!conflictMap.has(a.id) && conflictMap.has(b.id)) return 1;
      return getSortByKoreanName(a, b);
  });

  priorityStudents.forEach(student => {
      let candidates = activeClassNames.filter(c => 
          !hasConflictInClass(student, c) && 
          !hasSameNameInClass(student, c) &&
          checkOriginConstraints(student, c)
      );

      if (candidates.length === 0) {
          candidates = activeClassNames.filter(c => 
            !hasConflictInClass(student, c) && 
            !hasSameNameInClass(student, c)
          );
      }
      if (candidates.length === 0) candidates = activeClassNames; 

      candidates.sort((a, b) => {
          if (student.생활지도 === '상') {
              if (classHighGuidanceCount[a] !== classHighGuidanceCount[b]) {
                  return classHighGuidanceCount[a] - classHighGuidanceCount[b];
              }
          }
          const loadA = getVirtualLoad(a);
          const loadB = getVirtualLoad(b);
          if (loadA !== loadB) return loadA - loadB;

          return 0;
      });

      assignToClass(student, candidates[0]);
  });


  // ==========================================
  // PHASE 4: General Allocation (Sequential by Old Class)
  // ==========================================
  const generalStudents = students.filter(s => !s.배정학급 && !s.전출예정);
  
  const studentsByClass: Record<number, Student[]> = {};
  generalStudents.forEach(s => {
      if (!studentsByClass[s.현학급]) studentsByClass[s.현학급] = [];
      studentsByClass[s.현학급].push(s);
  });

  const assignGroup = (group: Student[], startIndex: number) => {
      group.forEach(student => {
        let candidates = activeClassNames.filter(c => 
            !hasConflictInClass(student, c) && 
            !hasSameNameInClass(student, c) &&
            checkOriginConstraints(student, c)
        );

        if (candidates.length === 0) {
            candidates = activeClassNames.filter(c => 
                !hasConflictInClass(student, c) && 
                !hasSameNameInClass(student, c)
            );
        }
        if (candidates.length === 0) candidates = activeClassNames;

        candidates.sort((a, b) => {
            // Priority 1: Virtual Load (Strict Size Balance)
            const loadA = getVirtualLoad(a);
            const loadB = getVirtualLoad(b);
            if (loadA !== loadB) return loadA - loadB;

            // Priority 2: Origin Pairing (Require 1 M and 1 F from same origin)
            // Goal: If class 'a' has opposite gender from same origin but NO same gender, prioritize it to complete the pair.
            const origin = student.현학급;
            const oppGender = student.성별 === '남성' ? '여성' : '남성';
            
            const hasOppA = classAssignments[a].some(s => s.현학급 === origin && s.성별 === oppGender);
            const hasOppB = classAssignments[b].some(s => s.현학급 === origin && s.성별 === oppGender);
            
            const hasSameA = classAssignments[a].some(s => s.현학급 === origin && s.성별 === student.성별);
            const hasSameB = classAssignments[b].some(s => s.현학급 === origin && s.성별 === student.성별);

            // Score: 
            // 2 = Has Opposite AND Not Same (Completes Pair)
            // 1 = Not Same (Fresh Slot)
            // 0 = Has Same (Stacking)
            const scoreA = (hasOppA && !hasSameA) ? 2 : (!hasSameA ? 1 : 0);
            const scoreB = (hasOppB && !hasSameB) ? 2 : (!hasSameB ? 1 : 0);
            
            if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first

            // Priority 3: Global Gender Balance (within tied load/origin score)
            const genderA = getGenderCount(a, student.성별);
            const genderB = getGenderCount(b, student.성별);
            if (genderA !== genderB) return genderA - genderB;

            // Priority 4: Rotation (Distance from Start Index)
            const indexA = activeClassNames.indexOf(a);
            const indexB = activeClassNames.indexOf(b);
            const distA = (indexA - startIndex + nextClassCount) % nextClassCount;
            const distB = (indexB - startIndex + nextClassCount) % nextClassCount;
            return distA - distB;
        });

        assignToClass(student, candidates[0]);
      });
  };

  // Process sequentially by class number
  for (let c = 1; c <= currentClassCount; c++) {
      if (!studentsByClass[c]) continue;
      
      const classStudents = studentsByClass[c];
      const males = classStudents.filter(s => s.성별 === '남성');
      const females = classStudents.filter(s => s.성별 === '여성');

      // Male Start: (c - 1) % N
      const maleStartIndex = (c - 1) % nextClassCount;
      assignGroup(males, maleStartIndex);

      // Female Start: c % N
      const femaleStartIndex = c % nextClassCount;
      assignGroup(females, femaleStartIndex);
  }

  // Handle remaining students (Edge Case)
  const remainingStudents = generalStudents.filter(s => !s.배정학급);
  if (remainingStudents.length > 0) {
      assignGroup(remainingStudents, 0);
  }


  // ==========================================
  // PHASE 5: Transfer Students
  // ==========================================
  const transferStudents = students.filter(s => s.전출예정);
  const normalClasses = activeClassNames.filter(name => !hasIntegratedStudent[name]);
  const targetClassesForTransfer = normalClasses.length > 0 ? normalClasses : activeClassNames;

  transferStudents.forEach(student => {
      let candidates = targetClassesForTransfer.filter(c => !hasConflictInClass(student, c));
      if (candidates.length === 0) candidates = targetClassesForTransfer;

      candidates.sort((a, b) => {
          if (classTransferCount[a] !== classTransferCount[b]) {
              return classTransferCount[a] - classTransferCount[b];
          }
          return classAssignments[a].length - classAssignments[b].length;
      });

      assignToClass(student, candidates[0]);
  });


  // Final Sort by Name (with Transfer Students Last) and Assign Numbers
  activeClassNames.forEach(name => {
      classAssignments[name].sort((a, b) => {
          if (a.전출예정 && !b.전출예정) return 1;
          if (!a.전출예정 && b.전출예정) return -1;
          return getSortByKoreanName(a, b);
      });

      classAssignments[name].forEach((s, idx) => {
          s.출석번호 = idx + 1;
      });
  });

  const finalResult = Object.values(classAssignments).flat();

  return {
    assignments: classAssignments,
    activeClassNames,
    stats: {
        totalStudents: finalResult.length,
        totalMale: finalResult.filter(s => s.성별 === '남성').length,
        totalFemale: finalResult.filter(s => s.성별 === '여성').length,
        duplicates: finalResult.filter(s => s.동명이인).length,
        highGuidance: finalResult.filter(s => s.생활지도 === '상').length,
        integrated: finalResult.filter(s => s.통합학급).length
    }
  };
};