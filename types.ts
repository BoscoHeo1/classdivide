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
  };
  activeClassNames: string[];
}

export const EXCEL_HEADERS = [
  '학년', '반', '번호', '성명', '성별', '생년월일', '학습부진', '생활지도', '학생선수', '통합학급', '학부모민원', '쌍둥이', '전출예정', '분리배정'
];