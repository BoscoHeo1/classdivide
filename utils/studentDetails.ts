import type { PlacementResult, Student } from '../types';

export const studentDetailsFields = [
  '학습부진', '생활지도', '학생선수', '통합학급', '학부모민원',
  '쌍둥이', '쌍둥이옵션', '전출예정', '분리배정'
] as const;

export type StudentDetails = Required<Pick<Student, typeof studentDetailsFields[number]>>;
export const MAX_SEPARATION_LENGTH = 1000;

// 과거 자료의 생략된 값도 비교와 편집 시에는 같은 기본값으로 취급합니다.
export const getStudentDetails = (student: Partial<Student>): StudentDetails => ({
  학습부진: student.학습부진 === true,
  생활지도: ['상', '중', '하'].includes(student.생활지도 || '') ? student.생활지도 as StudentDetails['생활지도'] : '',
  학생선수: student.학생선수 === true,
  통합학급: student.통합학급 === true,
  학부모민원: student.학부모민원 === true,
  쌍둥이: student.쌍둥이 === true,
  쌍둥이옵션: student.쌍둥이 === true && student.쌍둥이옵션 === '동일' ? '동일' : '분리',
  전출예정: student.전출예정 === true,
  분리배정: String(student.분리배정 ?? '')
});

export const detailsEqual = (left: Partial<Student>, right: Partial<Student>): boolean => {
  const a = getStudentDetails(left);
  const b = getStudentDetails(right);
  return studentDetailsFields.every(field => a[field] === b[field]);
};

const isSameStudent = (student: Student, target: Student): boolean =>
  student.id === target.id && student.현학급 === target.현학급
  && student.이름 === target.이름 && String(student.번호 ?? '') === String(target.번호 ?? '')
  && String(student.생년월일 || '') === String(target.생년월일 || '')
  && String(student.학년 ?? '') === String(target.학년 ?? '');

// 허용한 특이사항 필드만 복사하며 자유 비고·배정·학생 신원은 보존합니다.
export const replaceStudentDetails = (students: Student[], target: Student, details: StudentDetails): Student[] => {
  const normalized = getStudentDetails(details);
  if (normalized.분리배정.length > MAX_SEPARATION_LENGTH) {
    throw new Error(`분리배정은 ${MAX_SEPARATION_LENGTH}자 이내로 입력해주세요.`);
  }
  return students.map(student => isSameStudent(student, target) ? { ...student, ...normalized } : student);
};

export const replaceResultStudentDetails = (
  result: PlacementResult | null, target: Student, details: StudentDetails
): PlacementResult | null => result ? {
  ...result,
  assignments: Object.fromEntries(Object.entries(result.assignments).map(([name, students]) =>
    [name, replaceStudentDetails(students, target, details)]))
} : null;

export const studentDetailsSummary = (student: Partial<Student>): string => {
  const details = getStudentDetails(student);
  return [
    details.학습부진 && '학습부진', details.생활지도 && `생활(${details.생활지도})`,
    details.학생선수 && '학생선수', details.통합학급 && '특수(통합)',
    details.학부모민원 && '민원', details.쌍둥이 && `쌍둥이(${details.쌍둥이옵션 === '동일' ? '같은반' : '분리'})`,
    details.전출예정 && '전출예정', details.분리배정 && `분리(${details.분리배정})`
  ].filter(Boolean).join(', ') || '-';
};
