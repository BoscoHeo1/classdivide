import { PlacementResult, Student } from '../types';
import { StudentDetails, studentDetailsFields } from './studentDetails';

export interface RemarkRecord { text: string; version: number; identity: string; signature?: string; details?: StudentDetails; }
export type RemarkRecords = Record<string, RemarkRecord>;
export const remarkKey = (student: Student) => `${student.현학급}:${student.id}`;
export const studentSignature = (student: Student) => JSON.stringify([
  student.현학급, String(student.이름 || ''), String(student.번호 ?? ''),
  String(student.생년월일 || ''), String(student.학년 ?? '')
]);
export const matchRemarkRecords = async (students: Student[], notes: RemarkRecords): Promise<RemarkRecords> => {
  const matched: RemarkRecords = {};
  await Promise.all(students.map(async student => {
    const key = remarkKey(student);
    if (!notes[key]) return;
    const signature = studentSignature(student);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
    const identity = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (notes[key].identity === identity) matched[key] = { ...notes[key], signature };
  }));
  return matched;
};
export const applyRemarks = (students: Student[], notes: RemarkRecords): Student[] =>
  students.map(student => notes[remarkKey(student)]?.signature === studentSignature(student)
    ? { ...student, ...notes[remarkKey(student)].details, 비고: notes[remarkKey(student)].text } : student);
export const applyResultRemarks = (result: PlacementResult | null, notes: RemarkRecords): PlacementResult | null =>
  result ? { ...result, assignments: Object.fromEntries(Object.entries(result.assignments).map(([key, students]) =>
    [key, applyRemarks(students, notes)])) } : null;

// 동일 학생의 자유 비고만 교체하며 반 배정·번호·특이사항은 그대로 둡니다.
export const replaceRemark = (students: Student[], target: Student, text: string) => students.map(student =>
  student.id === target.id && studentSignature(student) === studentSignature(target) ? { ...student, 비고: text } : student);
export const replaceResultRemark = (result: PlacementResult | null, target: Student, text: string): PlacementResult | null =>
  result ? { ...result, assignments: Object.fromEntries(Object.entries(result.assignments).map(([key, students]) =>
    [key, replaceRemark(students, target, text)])) } : null;

// 암호화 수정값은 결과 DB에 평문으로 복제하지 않고 화면·내보내기에서만 합칩니다.
export const resultForStorage = (result: PlacementResult, rawStudents: Student[]): PlacementResult => {
  const originals = new Map(rawStudents.map(student => [studentSignature(student), student]));
  return { ...result, assignments: Object.fromEntries(Object.entries(result.assignments).map(([key, students]) => [key,
    students.map(student => {
      const original = originals.get(studentSignature(student));
      if (!original) throw new Error('학생 명단이 변경되었습니다. 최신 명단으로 다시 실행해주세요.');
      const raw = { ...student };
      for (const field of [...studentDetailsFields, '비고'] as const) {
        if (Object.hasOwn(original, field)) (raw as any)[field] = original[field];
        else delete raw[field];
      }
      return raw;
    })])) };
};
