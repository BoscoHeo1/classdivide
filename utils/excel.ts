import * as XLSX from 'xlsx';
import { Student } from '../types';

export const parseExcel = (file: File): Promise<Student[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

        const students: Student[] = jsonData.map((row, index) => {
          let birthDate = row['생년월일'] || '';
          if (typeof birthDate === 'number') {
            const date = new Date((birthDate - 25569) * 86400 * 1000);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            birthDate = `${y}.${m}.${d}`;
          } else if (typeof birthDate === 'string') {
            birthDate = birthDate.replace(/-/g, '.');
          }

          const checkValue = (val: any) => val === 'O' || val === 'o' || val === '1' || val === 1 || val === true;
          
          let gender = row['성별'] || '';
          if (gender === '남' || gender === '남자') gender = '남성';
          if (gender === '여' || gender === '여자') gender = '여성';

          return {
            id: index + 1,
            학년: row['학년'] || '',
            현학급: parseInt(row['반'] || row['현학급'] || row['현재학급'] || '0'),
            번호: row['번호'] || '',
            이름: row['성명'] || row['이름'] || '',
            성별: gender,
            생년월일: birthDate,
            학습부진: checkValue(row['학습부진']),
            생활지도: row['생활지도'] || '',
            학생선수: checkValue(row['학생선수']),
            통합학급: checkValue(row['통합학급']),
            학부모민원: checkValue(row['학부모민원']),
            쌍둥이: checkValue(row['쌍둥이']),
            전출예정: checkValue(row['전출예정']),
            분리배정: row['분리배정'] || row['분리요청'] || row['분리요청학생'] || ''
          };
        }).filter(s => s.이름 && s.현학급);

        // Check for duplicate names
        const nameCount: Record<string, number> = {};
        students.forEach(s => { nameCount[s.이름] = (nameCount[s.이름] || 0) + 1; });
        students.forEach(s => { s.동명이인 = nameCount[s.이름] > 1; });

        resolve(students);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const generateTemplate = () => {
  const templateData = [
    { 
      '학년': 5, '반': 1, '번호': 1, '성명': '홍길동', '성별': '남성', '생년월일': '2014.03.15', 
      '학습부진': '', '생활지도': '', '학생선수': '', '통합학급': '', '학부모민원': '', '쌍둥이': '', '전출예정': '',
      '분리요청학생': '1반 김철수'
    }
  ];
  const ws = XLSX.utils.json_to_sheet(templateData);
  ws['!cols'] = [
    { wch: 6 }, { wch: 4 }, { wch: 6 }, { wch: 10 }, { wch: 6 }, { wch: 12 }, 
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 20 }
  ];
  XLSX.utils.sheet_add_aoa(ws, [['※ 성별: 남성/여성, 특이사항: O, 생활지도: 상/중/하, 분리요청학생: [반 이름] (예: 1반 김철수)']], { origin: 'A3' });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생명단');
  XLSX.writeFile(wb, '학급편성_입력템플릿.xlsx');
};

export const generateSampleData = () => {
  const sampleData: any[] = [];
  const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
  const maleNames = ['민준', '서준', '예준', '도윤', '시우', '주원', '하준', '지호', '준서', '준우'];
  const femaleNames = ['서연', '서윤', '지우', '서현', '민서', '하은', '하윤', '윤서', '지유', '채원'];
  const guidanceLevels = ['', '', '', '', '', '하', '하', '중', '중', '상'];
  
  let studentNum = 1;

  for (let classNum = 1; classNum <= 11; classNum++) {
      studentNum = 1;
      for (let i = 0; i < 12; i++) {
          const birthYear = 2014 + Math.floor(Math.random() * 2);
          const birthMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
          const birthDay = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
          sampleData.push({
              '학년': 5, '반': classNum, '번호': studentNum++,
              '성명': surnames[Math.floor(Math.random() * surnames.length)] + maleNames[Math.floor(Math.random() * maleNames.length)],
              '성별': '남성', '생년월일': `${birthYear}.${birthMonth}.${birthDay}`,
              '학습부진': Math.random() < 0.1 ? 'O' : '', '생활지도': guidanceLevels[Math.floor(Math.random() * guidanceLevels.length)],
              '학생선수': Math.random() < 0.05 ? 'O' : '', '통합학급': Math.random() < 0.03 ? 'O' : '', '학부모민원': Math.random() < 0.05 ? 'O' : '', '쌍둥이': '', '전출예정': Math.random() < 0.02 ? 'O' : '',
              '분리요청학생': ''
          });
      }
      for (let i = 0; i < 12; i++) {
          const birthYear = 2014 + Math.floor(Math.random() * 2);
          const birthMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
          const birthDay = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
          sampleData.push({
              '학년': 5, '반': classNum, '번호': studentNum++,
              '성명': surnames[Math.floor(Math.random() * surnames.length)] + femaleNames[Math.floor(Math.random() * femaleNames.length)],
              '성별': '여성', '생년월일': `${birthYear}.${birthMonth}.${birthDay}`,
              '학습부진': Math.random() < 0.1 ? 'O' : '', '생활지도': guidanceLevels[Math.floor(Math.random() * guidanceLevels.length)],
              '학생선수': Math.random() < 0.05 ? 'O' : '', '통합학급': Math.random() < 0.03 ? 'O' : '', '학부모민원': Math.random() < 0.05 ? 'O' : '', '쌍둥이': '', '전출예정': Math.random() < 0.02 ? 'O' : '',
              '분리요청학생': ''
          });
      }
  }
  
  // Force a duplicate name for testing
  sampleData[0]['성명'] = '김민준'; 
  sampleData[24]['성명'] = '김민준';
  
  // Force twins (same DOB, marked as Twins)
  sampleData[5]['쌍둥이'] = 'O';
  sampleData[5]['생년월일'] = '2014.05.05';
  sampleData[6]['쌍둥이'] = 'O';
  sampleData[6]['생년월일'] = '2014.05.05';
  sampleData[6]['성명'] = sampleData[5]['성명'].substring(0, 1) + '동생'; // similar name

  // Force Separation Request (With Class format)
  const targetStudent = sampleData[11];
  sampleData[10]['분리요청학생'] = `${targetStudent['반']}반 ${targetStudent['성명']}`;

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생명단');
  XLSX.writeFile(wb, '학급편성_샘플데이터.xlsx');
};

const formatStudentForExcel = (s: Student, useOriginalNumber: boolean = false) => {
    const remarks = [];
    if (s.동명이인) remarks.push('동명이인');
    if (s.전출예정) remarks.push('전출예정');
    if (s.학습부진) remarks.push('학습부진');
    if (s.생활지도) remarks.push(`생활(${s.생활지도})`);
    if (s.학생선수) remarks.push('학생선수');
    if (s.통합학급) remarks.push('통합학급');
    if (s.학부모민원) remarks.push('민원');
    if (s.쌍둥이) remarks.push('쌍둥이');
    if (s.분리배정) remarks.push('분리요청');

    return {
        '출석번호': useOriginalNumber ? s.번호 : s.출석번호,
        '이름': s.이름,
        '성별': s.성별, 
        '생년월일': s.생년월일,
        '이전학급': s.현학급 + '반', 
        '배정학급': s.배정학급 + '반',
        '특이사항': remarks.join(', ')
    };
};

// Download 1: Grouped by Assigned Class (New)
export const downloadResultsByNewClass = (result: Student[], classAssignments: Record<string, Student[]>) => {
  const resultData = result.map(s => formatStudentForExcel(s, false));
  const ws = XLSX.utils.json_to_sheet(resultData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '전체결과');

  Object.keys(classAssignments).sort().forEach(className => {
      const classStudents = classAssignments[className].map(s => formatStudentForExcel(s, false));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(classStudents), `${className}반`);
  });
  
  XLSX.writeFile(wb, '학급편성결과(배정반기준).xlsx');
};

// Download 2: Sorted by Existing Class (Old)
export const downloadResultsByOldClass = (result: Student[]) => {
  // Sort by Old Class, then Old Number (Student Register Order)
  const sortedStudents = [...result].sort((a, b) => {
      if (a.현학급 !== b.현학급) return a.현학급 - b.현학급;
      const numA = parseInt(String(a.번호)) || 0;
      const numB = parseInt(String(b.번호)) || 0;
      return numA - numB;
  });

  const resultData = sortedStudents.map(s => formatStudentForExcel(s, true));
  const ws = XLSX.utils.json_to_sheet(resultData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '전체결과');

  // Group by Old Class
  const studentsByClass: Record<number, Student[]> = {};
  sortedStudents.forEach(s => {
      if (!studentsByClass[s.현학급]) {
          studentsByClass[s.현학급] = [];
      }
      studentsByClass[s.현학급].push(s);
  });

  // Create sheet for each Old Class
  Object.keys(studentsByClass)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(classNum => {
        // Explicitly sort each class sheet by original number
        const classStudentsRaw = studentsByClass[classNum].sort((a, b) => {
            const numA = parseInt(String(a.번호)) || 0;
            const numB = parseInt(String(b.번호)) || 0;
            return numA - numB;
        });

        const classStudentsFormatted = classStudentsRaw.map(s => formatStudentForExcel(s, true));
        const classWs = XLSX.utils.json_to_sheet(classStudentsFormatted);
        XLSX.utils.book_append_sheet(wb, classWs, `${classNum}반`);
    });
  
  XLSX.writeFile(wb, '학급편성결과(기존반기준).xlsx');
};