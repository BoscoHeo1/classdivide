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
  const classMidGuidanceCount: Record<string, number> = {}; // 생활지도 '중' 카운트
  const classLowGuidanceCount: Record<string, number> = {}; // 생활지도 '하' 카운트
  const classAcademicSupportCount: Record<string, number> = {}; // 학습부진 카운트
  const classAthleteCount: Record<string, number> = {}; // 운동부(학생선수) 카운트
  const classParentComplaintCount: Record<string, number> = {}; // 학부모 민원 카운트
  const classTransferCount: Record<string, number> = {};
  const classOriginCount: Record<string, Record<number, number>> = {}; 
  const classOriginGenderCount: Record<string, Record<string, number>> = {}; 

  activeClassNames.forEach(name => {
    classAssignments[name] = [];
    hasIntegratedStudent[name] = false;
    classHighGuidanceCount[name] = 0;
    classMidGuidanceCount[name] = 0;
    classLowGuidanceCount[name] = 0;
    classAcademicSupportCount[name] = 0;
    classAthleteCount[name] = 0;
    classParentComplaintCount[name] = 0;
    classTransferCount[name] = 0;
    classOriginCount[name] = {};
    classOriginGenderCount[name] = {};
  });

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

  // 1. Twins Logic (분리 vs 같은 반 선택 반영)
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
            // 같은 반 희망: togetherMap에 등록하여 반드시 동반 배정
            addTogether(group[i].id, group[j].id);
          } else {
            // 분리 희망 (기본값): conflictMap에 등록하여 서로 다른 반 배정
            addConflict(group[i].id, group[j].id);
          }
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
    if (conflicts && classAssignments[className].some(s => conflicts.has(s.id))) {
      return true;
    }
    // 같은 반 희망 파트너(쌍둥이)의 충돌도 함께 검사
    const partners = togetherMap.get(student.id);
    if (partners) {
      for (const partnerId of partners) {
        const partnerConflicts = conflictMap.get(partnerId);
        if (partnerConflicts && classAssignments[className].some(s => partnerConflicts.has(s.id))) {
          return true;
        }
      }
    }
    return false;
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

    // 3. Guidance (생활지도 상/중/하)
    if (student.생활지도 === '상') {
        classHighGuidanceCount[className]++;
    } else if (student.생활지도 === '중') {
        classMidGuidanceCount[className]++;
    } else if (student.생활지도 === '하') {
        classLowGuidanceCount[className]++;
    }

    // 4. Academic Support (학습부진)
    if (student.학습부진) {
        classAcademicSupportCount[className]++;
    }

    // 5. Athlete (운동부/학생선수)
    if (student.학생선수) {
        classAthleteCount[className]++;
    }

    // 6. Parent Complaint (학부모민원)
    if (student.학부모민원) {
        classParentComplaintCount[className]++;
    }

    // 7. Transfer
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

  // 생년월일 정규화 헬퍼 (YYYYMMDD 8자리 표준 문자열 변환)
  const normalizeBirthDate = (dob?: string): string => {
    if (!dob) return '99999999'; // 생년월일 미기재 시 후순위 배치
    const cleaned = String(dob).replace(/[^0-9]/g, '');
    if (cleaned.length === 8) return cleaned; // 예: 20130512
    if (cleaned.length === 6) {
      // 6자리(예: 130512)인 경우 학생 연령대 기준 2000년대/1900년대 접두어 처리
      const yearPrefix = parseInt(cleaned.slice(0, 2), 10) < 50 ? '20' : '19';
      return `${yearPrefix}${cleaned}`;
    }
    return cleaned.padEnd(8, '0');
  };

  // 생년월일 빠른 순(오름차순: 1월 1일생 -> 12월 31일생) 정렬 함수
  const getSortByBirthDate = (a: Student, b: Student): number => {
    const dateA = normalizeBirthDate(a.생년월일);
    const dateB = normalizeBirthDate(b.생년월일);
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }
    // 생년월일이 동일한 경우 기존 출석번호 순 -> 이름 가나다 순으로 안정적 정렬 유지
    const numA = Number(a.번호) || 0;
    const numB = Number(b.번호) || 0;
    if (numA !== numB) return numA - numB;
    return a.이름.localeCompare(b.이름, 'ko');
  };

  const assignToClass = (student: Student, className: string) => {
    if (student.배정학급) return; // 이미 배정된 학생 중복 방지
    student.배정학급 = className;
    classAssignments[className].push(student);
    if (student.통합학급) hasIntegratedStudent[className] = true;
    trackAssignment(student, className);

    // 같은 반 희망 쌍둥이 형제/자매 즉시 동일 학급 동반 배정
    const partners = togetherMap.get(student.id);
    if (partners) {
      partners.forEach(partnerId => {
        const partner = students.find(s => s.id === partnerId);
        if (partner && !partner.배정학급) {
          assignToClass(partner, className);
        }
      });
    }
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
  // PHASE 2 & 3: Priorities (생활지도, 분리, 운동부, 학습부진, 민원)
  // ==========================================
  const priorityStudents = students.filter(s => 
      !s.배정학급 && !s.전출예정 && 
      (s.생활지도 === '상' || conflictMap.has(s.id) || s.학생선수 || s.학습부진 || s.학부모민원)
  );

  priorityStudents.sort((a, b) => {
      // 1순위: 생활지도 '상'
      if (a.생활지도 === '상' && b.생활지도 !== '상') return -1;
      if (a.생활지도 !== '상' && b.생활지도 === '상') return 1;
      // 2순위: 충돌(분리배정 요구)
      if (conflictMap.has(a.id) && !conflictMap.has(b.id)) return -1;
      if (!conflictMap.has(a.id) && conflictMap.has(b.id)) return 1;
      // 3순위: 운동부(학생선수)
      if (a.학생선수 && !b.학생선수) return -1;
      if (!a.학생선수 && b.학생선수) return 1;
      // 4순위: 학습부진
      if (a.학습부진 && !b.학습부진) return -1;
      if (!a.학습부진 && b.학습부진) return 1;
      // 5순위: 학부모 민원
      if (a.학부모민원 && !b.학부모민원) return -1;
      if (!a.학부모민원 && b.학부모민원) return 1;
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
          // 1. 생활지도 '상' 최소 학급 우선 (특수/통합학급 학생 배정반은 +2 가중치로 일반반 우선 배정)
          if (student.생활지도 === '상') {
              const penaltyA = hasIntegratedStudent[a] ? 2 : 0;
              const penaltyB = hasIntegratedStudent[b] ? 2 : 0;
              const effectiveA = classHighGuidanceCount[a] + penaltyA;
              const effectiveB = classHighGuidanceCount[b] + penaltyB;
              if (effectiveA !== effectiveB) {
                  return effectiveA - effectiveB;
              }
          }
          // 2. 운동부(학생선수) 최소 학급 우선
          if (student.학생선수) {
              if (classAthleteCount[a] !== classAthleteCount[b]) {
                  return classAthleteCount[a] - classAthleteCount[b];
              }
          }
          // 3. 학습부진 최소 학급 우선
          if (student.학습부진) {
              if (classAcademicSupportCount[a] !== classAcademicSupportCount[b]) {
                  return classAcademicSupportCount[a] - classAcademicSupportCount[b];
              }
          }
          // 4. 학부모 민원 최소 학급 우선
          if (student.학부모민원) {
              if (classParentComplaintCount[a] !== classParentComplaintCount[b]) {
                  return classParentComplaintCount[a] - classParentComplaintCount[b];
              }
          }
          // 5. 전체 인원(가상 부하) 균형
          const loadA = getVirtualLoad(a);
          const loadB = getVirtualLoad(b);
          if (loadA !== loadB) return loadA - loadB;

          // 6. 성별 균형
          const genderA = getGenderCount(a, student.성별);
          const genderB = getGenderCount(b, student.성별);
          if (genderA !== genderB) return genderA - genderB;

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
            const origin = student.현학급;
            const oppGender = student.성별 === '남성' ? '여성' : '남성';
            
            const hasOppA = classAssignments[a].some(s => s.현학급 === origin && s.성별 === oppGender);
            const hasOppB = classAssignments[b].some(s => s.현학급 === origin && s.성별 === oppGender);
            
            const hasSameA = classAssignments[a].some(s => s.현학급 === origin && s.성별 === student.성별);
            const hasSameB = classAssignments[b].some(s => s.현학급 === origin && s.성별 === student.성별);

            const scoreA = (hasOppA && !hasSameA) ? 2 : (!hasSameA ? 1 : 0);
            const scoreB = (hasOppB && !hasSameB) ? 2 : (!hasSameB ? 1 : 0);
            
            if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first

            // Priority 3: Global Gender Balance (within tied load/origin score)
            const genderA = getGenderCount(a, student.성별);
            const genderB = getGenderCount(b, student.성별);
            if (genderA !== genderB) return genderA - genderB;

            // Priority 4: 생활지도 '중' 및 '하' 균등 분산
            if (student.생활지도 === '중') {
                const midA = classMidGuidanceCount[a] || 0;
                const midB = classMidGuidanceCount[b] || 0;
                if (midA !== midB) return midA - midB;
            } else if (student.생활지도 === '하') {
                const lowA = classLowGuidanceCount[a] || 0;
                const lowB = classLowGuidanceCount[b] || 0;
                if (lowA !== lowB) return lowA - lowB;
            }

            // Priority 5: Rotation (Distance from Start Index)
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
      // 각 학급의 남학생과 여학생을 생년월일 빠른 순(오름차순)으로 정렬
      const males = classStudents.filter(s => s.성별 === '남성').sort(getSortByBirthDate);
      const females = classStudents.filter(s => s.성별 === '여성').sort(getSortByBirthDate);

      // Male Start: (c - 1) % N (생년월일 빠른 순으로 순환 배정)
      const maleStartIndex = (c - 1) % nextClassCount;
      assignGroup(males, maleStartIndex);

      // Female Start: c % N (생년월일 빠른 순으로 순환 배정)
      const femaleStartIndex = c % nextClassCount;
      assignGroup(females, femaleStartIndex);
  }

  // Handle remaining students (Edge Case: 미배정 잔여 학생도 성별/생년월일 순 정렬 배정)
  const remainingStudents = generalStudents.filter(s => !s.배정학급);
  if (remainingStudents.length > 0) {
      const remainingMales = remainingStudents.filter(s => s.성별 === '남성').sort(getSortByBirthDate);
      const remainingFemales = remainingStudents.filter(s => s.성별 === '여성').sort(getSortByBirthDate);
      assignGroup(remainingMales, 0);
      assignGroup(remainingFemales, 0);
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
        integrated: finalResult.filter(s => s.통합학급).length,
        underachieving: finalResult.filter(s => s.학습부진).length,
        athletes: finalResult.filter(s => s.학생선수).length,
        parentComplaints: finalResult.filter(s => s.학부모민원).length
    }
  };
};