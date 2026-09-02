export interface Student {
  id: number;
  학년: number | string;
  현학급: number;
  번호: number | string;
  이름: string;
  성별: '남성' | '여성';
  생년월일: string;
  학습부진: boolean;
  생활지도: '상' | '중' | '하' | '';
  학생선수: boolean;
  통합학급: boolean;
  학부모민원: boolean;
  쌍둥이: boolean;
  쌍둥이옵션?: '분리' | '동일';
  전출예정: boolean;
  분리배정?: string; // New field for separation request
  동명이인?: boolean;
  배정학급?: string;
  출석번호?: number;
}

export interface ClassSettings {
  currentClassCount: number;
  nextClassCount: number;
  normalCapacity: number;
  reductionCount: number; // Reduction for integrated class
  placementOrder: 'zigzag' | 'linear';
}

export interface PlacementResult {
  assignments: Record<string, Student[]>;
  stats: {
    totalStudents: number;
    totalMale: number;
    totalFemale: number;
    duplicates: number;
    highGuidance: number;
    integrated: number;
    underachieving?: number;
    athletes?: number;
    parentComplaints?: number;
  };
  activeClassNames: string[];
}

export const EXCEL_HEADERS = [
  '학년', '반', '번호', '성명', '성별', '생년월일', '학습부진', '생활지도', '학생선수', '통합학급', '학부모민원', '쌍둥이', '전출예정', '분리배정'
];

export interface GradeWorkspace {
  code: string; // 학년 방 고유 코드
  name: string; // 학교 및 학년명 (예: 해봄초 5학년)
  password: string; // 관리자(학년부장) 실행 비밀번호
  currentClassCount: number; // 현재 학급 수
  nextClassCount: number; // 편성 학급 수
  reductionCount: number; // 특수학급 감축 인원
  placementOrder: 'zigzag' | 'linear';
  students: Student[]; // 전체 취합된 학생 명단
  classStatus: Record<number, { completed: boolean; teacherName?: string; updatedAt?: number }>;
  step: number; // 1: 입력취합, 2: 배정설정, 3: 결과확인
  result?: PlacementResult; // 최종 배정 결과
  hostId?: string; // 개설자 고유 브라우저 식별자
  updatedAt: number;
}