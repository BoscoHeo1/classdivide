import React, { useState, useRef } from 'react';
import { Upload, Download, Settings, Users, ArrowRight, CheckCircle, AlertTriangle, Play, HelpCircle, Plus, Trash2, Sliders, Hash, Layers, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

interface DynamicRule {
  id: string;
  columnName: string;
  type: 'categorical' | 'numerical';
}

interface DynamicPlacementResult {
  assignments: Record<string, any[]>;
  activeClassNames: string[];
  stats: {
    totalStudents: number;
    totalMale: number;
    totalFemale: number;
    ruleStats: Record<string, {
      type: 'categorical' | 'numerical';
      byClass: Record<string, {
        averages?: number;
        counts?: Record<string, number>;
      }>;
      global: {
        averages?: number;
        counts?: Record<string, number>;
      }
    }>;
    dispersionStats: Record<string, Record<string, number>>; // Old class distribution per new class
  };
}

export const DynamicWizard: React.FC = () => {
  // State
  const [rawData, setRawData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Column Mappings
  const [mappings, setMappings] = useState({
    nameKey: '',
    genderKey: '',
    oldClassKey: ''
  });

  // Dynamic Rules
  const [rules, setRules] = useState<DynamicRule[]>([]);

  // Class count setting
  const [nextClassCount, setNextClassCount] = useState<number>(6);
  const [placementOrder, setPlacementOrder] = useState<'zigzag' | 'linear'>('zigzag');

  // Results State
  const [result, setResult] = useState<DynamicPlacementResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>('');
  const [step, setStep] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse custom Excel file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

        if (jsonData.length === 0) {
          throw new Error('엑셀 파일에 데이터가 없습니다.');
        }

        // Get all unique keys (columns)
        const allKeys = Array.from(
          new Set(jsonData.flatMap((row) => Object.keys(row)))
        ).filter(key => !key.startsWith('__'));

        setRawData(jsonData);
        setColumns(allKeys);
        setFileName(file.name);

        // Smart column mapping auto-detection
        const detectKey = (options: string[], defaultVal = '') => {
          const match = allKeys.find(k => options.some(opt => k.toLowerCase().includes(opt.toLowerCase())));
          return match || defaultVal;
        };

        const detectedName = detectKey(['이름', '성명', '성함', 'name'], allKeys[0] || '');
        const detectedGender = detectKey(['성별', '성', 'gender', 'sex'], allKeys[1] || '');
        const detectedClass = detectKey(['반', '학급', '현재반', '이전반', 'class'], allKeys[2] || '');

        setMappings({
          nameKey: detectedName,
          genderKey: detectedGender,
          oldClassKey: detectedClass
        });

        // Set estimated dest classes (total / 24)
        const estClasses = Math.ceil(jsonData.length / 24);
        setNextClassCount(estClasses > 0 ? estClasses : 6);

        // Clear any previous state
        setRules([]);
        setResult(null);
        setStep(2);
      } catch (err: any) {
        setError(err.message || '파일을 해석하는 중 에러가 발생했습니다.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setError('파일 로딩 중 장애가 발생했습니다.');
      setLoading(false);
    };
    reader.readAsArrayBuffer(file);
  };

  // Add a dynamic rule
  const addRule = () => {
    const remainingColumns = columns.filter(col => 
      col !== mappings.nameKey && 
      col !== mappings.genderKey && 
      col !== mappings.oldClassKey &&
      !rules.some(r => r.columnName === col)
    );

    const nextCol = remainingColumns[0] || columns[0] || '';
    const newRule: DynamicRule = {
      id: Math.random().toString(36).substring(2, 9),
      columnName: nextCol,
      type: 'categorical'
    };
    setRules([...rules, newRule]);
  };

  const updateRule = (id: string, field: keyof DynamicRule, value: any) => {
    setRules(rules.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const removeRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  // Safe parsing helper for values
  const getNumericalValue = (val: any): number => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // Main Dynamic Placement Algorithm!
  const runDynamicPlacement = () => {
    if (!mappings.nameKey) {
      setError('학생 이름 컬럼을 반드시 매핑해야 합니다.');
      return;
    }

    setLoading(true);
    setError(null);

    setTimeout(() => {
      try {
        // 1. Setup destination class names
        const classNames: string[] = [];
        for (let i = 1; i <= nextClassCount; i++) {
          classNames.push(`${i}반`);
        }

        // Initialize assignments
        const assignments: Record<string, any[]> = {};
        classNames.forEach(name => {
          assignments[name] = [];
        });

        // 2. Preprocess students
        const processedStudents = rawData.map((row, idx) => {
          const name = String(row[mappings.nameKey] || `학생_${idx + 1}`).trim();
          
          // Normalize gender representation
          let rawGender = String(row[mappings.genderKey] || '').trim();
          let gender: '남성' | '여성' = '남성'; // Default
          if (rawGender.includes('여') || rawGender.toLowerCase() === 'f' || rawGender.toLowerCase() === 'female') {
            gender = '여성';
          }

          // Normalize current class string
          const oldClass = String(row[mappings.oldClassKey] || '미지정').trim();

          return {
            _originalRow: row,
            _id: idx + 1,
            _name: name,
            _gender: gender,
            _oldClass: oldClass
          };
        });

        // 3. Split by gender for perfect gender balance
        const boys = processedStudents.filter(s => s._gender === '남성');
        const girls = processedStudents.filter(s => s._gender === '여성');

        // Helper to sort students per group according to selected dynamic rules + old class rotation
        const sortGroup = (studentsList: typeof processedStudents) => {
          return [...studentsList].sort((a, b) => {
            // First we apply each selected dynamic rule sequentially
            for (const rule of rules) {
              const valA = a._originalRow[rule.columnName];
              const valB = b._originalRow[rule.columnName];

              if (rule.type === 'numerical') {
                const numA = getNumericalValue(valA);
                const numB = getNumericalValue(valB);
                if (numA !== numB) {
                  return numB - numA; // Descending order for grades/scores
                }
              } else {
                // Categorical - group matching categories together
                const catA = String(valA || '').trim();
                const catB = String(valB || '').trim();
                if (catA !== catB) {
                  return catA.localeCompare(catB);
                }
              }
            }

            // Fallback to rotating old classes to prevent students from the same class clumping
            if (a._oldClass !== b._oldClass) {
              return a._oldClass.localeCompare(b._oldClass);
            }

            return a._name.localeCompare(b._name);
          });
        };

        const sortedBoys = sortGroup(boys);
        const sortedGirls = sortGroup(girls);

        // Distribute helper
        const distributeList = (list: typeof processedStudents, startClassIndex: number) => {
          let cursor = startClassIndex;
          let direction = 1; // 1: forward, -1: backward (for zigzag)

          list.forEach((student) => {
            const destClass = classNames[cursor];
            assignments[destClass].push(student);

            // Calculate next class index
            if (placementOrder === 'linear') {
              cursor = (cursor + 1) % nextClassCount;
            } else {
              // Zigzag layout
              cursor += direction;
              if (cursor >= nextClassCount) {
                cursor = nextClassCount - 1;
                direction = -1;
              } else if (cursor < 0) {
                cursor = 0;
                direction = 1;
              }
            }
          });

          // Return the index we stopped at, so the next group can continue from there for balance
          return cursor;
        };

        // Distribute boys, then distribute girls starting from where boys ended to keep exact sizes
        const lastIndex = distributeList(sortedBoys, 0);
        distributeList(sortedGirls, (lastIndex + 1) % nextClassCount);

        // 4. Calculate Stats of the Placement
        const totalStudents = processedStudents.length;
        const totalMale = boys.length;
        const totalFemale = girls.length;

        // Compute rule-specific statistics across all destination classes
        const ruleStats: Record<string, any> = {};
        rules.forEach(rule => {
          const isNum = rule.type === 'numerical';
          const statsByClass: Record<string, any> = {};
          
          // Calculate global rule stats
          let globalAvg = 0;
          let globalSum = 0;
          let globalNumCount = 0;
          const globalCategoryCounts: Record<string, number> = {};

          processedStudents.forEach(s => {
            const val = s._originalRow[rule.columnName];
            if (isNum) {
              const numVal = getNumericalValue(val);
              globalSum += numVal;
              globalNumCount++;
            } else {
              const catVal = String(val || '미입력').trim();
              globalCategoryCounts[catVal] = (globalCategoryCounts[catVal] || 0) + 1;
            }
          });

          if (isNum && globalNumCount > 0) {
            globalAvg = Number((globalSum / globalNumCount).toFixed(2));
          }

          // Calculate by-class stats
          classNames.forEach(className => {
            const classStudents = assignments[className];
            let classSum = 0;
            let classNumCount = 0;
            const classCategoryCounts: Record<string, number> = {};

            classStudents.forEach(s => {
              const val = s._originalRow[rule.columnName];
              if (isNum) {
                const numVal = getNumericalValue(val);
                classSum += numVal;
                classNumCount++;
              } else {
                const catVal = String(val || '미입력').trim();
                classCategoryCounts[catVal] = (classCategoryCounts[catVal] || 0) + 1;
              }
            });

            statsByClass[className] = {
              averages: classNumCount > 0 ? Number((classSum / classNumCount).toFixed(2)) : 0,
              counts: classCategoryCounts
            };
          });

          ruleStats[rule.columnName] = {
            type: rule.type,
            byClass: statsByClass,
            global: {
              averages: globalAvg,
              counts: globalCategoryCounts
            }
          };
        });

        // 5. Old Class dispersion: How many from Old Class are in New Class
        const dispersionStats: Record<string, Record<string, number>> = {};
        classNames.forEach(cName => {
          dispersionStats[cName] = {};
          assignments[cName].forEach(s => {
            dispersionStats[cName][s._oldClass] = (dispersionStats[cName][s._oldClass] || 0) + 1;
          });
        });

        setResult({
          assignments,
          activeClassNames: classNames,
          stats: {
            totalStudents,
            totalMale,
            totalFemale,
            ruleStats,
            dispersionStats
          }
        });

        setActiveTab('ALL');
        setStep(3);
      } catch (err: any) {
        setError(`분배 중 에러가 발생했습니다: ${err.message || err}`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 150);
  };

  // Download finished results, preserving all raw columns and adding '배정학급'
  const downloadResults = () => {
    if (!result) return;

    try {
      // Flattens all assignments into a single array of rows with the added '배정학급' column
      const exportRows = result.activeClassNames.flatMap(cName => {
        return result.assignments[cName].map(s => {
          return {
            ...s._originalRow,
            '배정학급': cName
          };
        });
      });

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '편성결과_전체');

      // Add detailed worksheets to verify stats
      const statsSummaryData: any[] = [];
      result.activeClassNames.forEach(cName => {
        const classStudents = result.assignments[cName];
        const row: any = {
          '학급': cName,
          '총원': classStudents.length,
          '남학생': classStudents.filter(s => s._gender === '남성').length,
          '여학생': classStudents.filter(s => s._gender === '여성').length,
        };

        // Add dynamic rules info
        rules.forEach(rule => {
          const ruleInfo = result.stats.ruleStats[rule.columnName];
          if (rule.type === 'numerical') {
            row[`평균_${rule.columnName}`] = ruleInfo.byClass[cName].averages;
          } else {
            // Join string representations of counts
            const counts = ruleInfo.byClass[cName].counts;
            row[`${rule.columnName}_분포`] = Object.entries(counts || {})
              .map(([category, count]) => `${category}: ${count}명`)
              .join(', ');
          }
        });

        statsSummaryData.push(row);
      });

      const wsStats = XLSX.utils.json_to_sheet(statsSummaryData);
      XLSX.utils.book_append_sheet(wb, wsStats, '학급별 통계 검증');

      XLSX.writeFile(wb, `동적학급편성결과_${fileName || '결과'}`);
    } catch (err: any) {
      alert(`엑셀 파일 다운로드에 실패했습니다: ${err.message || err}`);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-indigo-100">
      
      {/* Visual Header Banner */}
      <div className="p-6 bg-gradient-to-r from-indigo-700 via-indigo-800 to-purple-800 text-white flex justify-between items-center">
        <div>
          <span className="bg-indigo-500/30 text-indigo-200 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
            ★ 임시 시험판 및 동적 설계 기능
          </span>
          <h2 className="text-2xl font-bold mt-1 text-white flex items-center">
            <Sliders className="w-6 h-6 mr-2 text-indigo-300" />
            자율 기준 동적 편성 모드
          </h2>
          <p className="text-xs text-indigo-200 mt-1">
            학교마다 서로 다른 특수 열(예: 영어점수, 체육소질, 다문화 여부 등)을 직접 매핑하고 맞춤형 기하/통계 배분을 할 수 있는 차세대 동적 편성을 미리 체험해보세요.
          </p>
        </div>
        <div className="hidden md:block">
          <HelpCircle className="w-12 h-12 text-indigo-300/40" />
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg text-sm text-red-700 flex items-start">
          <AlertTriangle className="w-5 h-5 mr-2 text-red-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Step Components */}
      {step === 1 && (
        <div className="p-8">
          <div className="max-w-xl mx-auto text-center space-y-6 py-8">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto text-indigo-600 shadow-inner">
              <Upload className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-800">1단계: 자유형 학교 엑셀 업로드</h3>
              <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                이 모드는 어떤 열 형식을 가졌든 상관없습니다. 학교에서 임의로 사용하던 기존 학생 엑셀 명단을 그대로 업로드해 보십시오.
              </p>
            </div>

            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-3 border-dashed border-indigo-200 rounded-2xl bg-indigo-50/20 hover:bg-indigo-50/50 hover:border-indigo-400 transition cursor-pointer p-10 flex flex-col items-center justify-center group"
            >
              <FileSpreadsheet className="w-12 h-12 text-indigo-400 group-hover:scale-110 transition-transform mb-3" />
              <span className="text-base font-semibold text-gray-700">엑셀(.xlsx, .xls) 파일 찾아보기</span>
              <span className="text-xs text-gray-400 mt-1">임의의 칼럼을 포함한 어떤 파일이든 무방합니다</span>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx,.xls" className="hidden" />
          </div>
        </div>
      )}

      {step === 2 && rawData.length > 0 && (
        <div className="p-8 space-y-10">
          
          {/* Column Target Matching */}
          <div className="bg-indigo-50/40 p-6 rounded-2xl border border-indigo-100/50 space-y-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center">
              <span className="bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">1</span>
              필수 열(Column) 매핑 지정
            </h3>
            <p className="text-xs text-gray-500">배정을 시행하기 위한 최소 주요 정보를 엑셀 열 이름과 매핑합니다. (자동 감지 완료)</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 block">이름(성명) 열</label>
                <select 
                  value={mappings.nameKey} 
                  onChange={e => setMappings({...mappings, nameKey: e.target.value})}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- 컬럼 선택 --</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 block">성별 열</label>
                <select 
                  value={mappings.genderKey} 
                  onChange={e => setMappings({...mappings, genderKey: e.target.value})}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- 컬럼 선택 (비었어도 무방) --</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 block">현재 학급(이전반) 열</label>
                <select 
                  value={mappings.oldClassKey} 
                  onChange={e => setMappings({...mappings, oldClassKey: e.target.value})}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">-- 컬럼 선택 (비었어도 무방) --</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Dynamic Criteria Add */}
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800 flex items-center">
                <span className="bg-indigo-600 text-white w-5 h-5 rounded-full flex items-center justify-center text-xs mr-2">2</span>
                동적 배정 기준 및 규칙 가산
              </h3>
              <button 
                onClick={addRule}
                disabled={rules.length >= columns.length - 3}
                className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-sm font-semibold transition flex items-center"
              >
                <Plus className="w-4 h-4 mr-1" /> 기준 추가
              </button>
            </div>
            
            <p className="text-xs text-gray-500 -mt-4">
              데이터의 고정 필드 외에, 원하는 열을 선택해 평균 값을 맞추거나(수치형) 비율을 동일 분포로 맞추도록(범주형) 지능형 배분 필터를 추가할 수 있습니다.
            </p>

            {rules.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                <p className="text-sm text-gray-400">추가적인 맞춤 설정 기준이 없습니다. 기본 성비 및 학급 분산 배치가 적용됩니다.</p>
                <button onClick={addRule} className="mt-3 text-xs font-semibold text-indigo-600 hover:underline">
                  + 지금 동적 검증 규칙 추가하기
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule, index) => (
                  <div key={rule.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200/60">
                    <div className="flex items-center text-xs font-bold text-gray-400 shrink-0 select-none">
                      기준 #{index + 1}
                    </div>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Column Picker */}
                      <div>
                        <select 
                          value={rule.columnName}
                          onChange={e => updateRule(rule.id, 'columnName', e.target.value)}
                          className="w-full text-sm px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600"
                        >
                          {columns.filter(col => 
                            col !== mappings.nameKey && 
                            col !== mappings.genderKey && 
                            col !== mappings.oldClassKey
                          ).map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>

                      {/* Rule Type Picker */}
                      <div className="flex rounded-lg border border-gray-300 overflow-hidden bg-white text-xs font-medium">
                        <button 
                          type="button"
                          onClick={() => updateRule(rule.id, 'type', 'categorical')}
                          className={`flex-1 py-2 text-center transition ${rule.type === 'categorical' ? 'bg-indigo-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          <span className="flex justify-center items-center">
                            <Layers className="w-3.5 h-3.5 mr-1" />
                            범주형 (값 균등비율 소분)
                          </span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => updateRule(rule.id, 'type', 'numerical')}
                          className={`flex-1 py-2 text-center transition ${rule.type === 'numerical' ? 'bg-indigo-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                          <span className="flex justify-center items-center">
                            <Hash className="w-3.5 h-3.5 mr-1" />
                            수치형 (합산/평균 균등화)
                          </span>
                        </button>
                      </div>
                    </div>

                    <button 
                      onClick={() => removeRule(rule.id)}
                      className="text-gray-400 hover:text-red-500 p-2 rounded-lg transition hover:bg-red-50 shrink-0 self-end sm:self-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dest Settings */}
          <div className="pt-6 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-700 block">편성할 새 학급 수</label>
              <input 
                type="number" 
                min={2} 
                max={30} 
                value={nextClassCount}
                onChange={e => setNextClassCount(Math.max(2, Number(e.target.value)))}
                className="w-full text-sm px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
              />
              <p className="text-xs text-gray-400">데이터 상의 총 {rawData.length}명의 학생들을 새로운 {nextClassCount}개 학급으로 균등 배분합니다.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-gray-700 block">배치 나선형 방식</label>
              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={() => setPlacementOrder('zigzag')}
                  className={`p-3 rounded-lg border text-xs text-left transition ${placementOrder === 'zigzag' ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                >
                  S자 (지그재그)
                </button>
                <button 
                  onClick={() => setPlacementOrder('linear')}
                  className={`p-3 rounded-lg border text-xs text-left transition ${placementOrder === 'linear' ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-semibold' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                >
                  순차 반복 (Linear)
                </button>
              </div>
            </div>
          </div>

          {/* Action Trigger */}
          <div className="bg-gray-50 -mx-8 -mb-8 p-6 flex justify-between items-center border-t border-gray-100">
            <button 
              onClick={() => {
                setRawData([]);
                setStep(1);
              }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-semibold"
            >
              다시 파일 업로드하기
            </button>
            <button 
              onClick={runDynamicPlacement}
              disabled={loading || !mappings.nameKey}
              className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition flex items-center disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? '편성 규칙 시뮬레이션 중...' : '동적 자율배정 실행'}
              <Play className="w-4 h-4 ml-2" />
            </button>
          </div>

        </div>
      )}

      {step === 3 && result && (
        <div className="p-8 space-y-8">
          
          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 p-5 rounded-xl border border-indigo-100">
              <span className="text-xs font-bold text-indigo-500 uppercase">성비 배정 평탄화 현황</span>
              <div className="text-2xl font-black text-indigo-900 mt-2">
                총 {result.stats.totalStudents}명 <span className="text-sm font-medium text-gray-500">(남: {result.stats.totalMale} / 여: {result.stats.totalFemale})</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">지정된 신규 {result.activeClassNames.length}개 반 명단에 성별을 최적 교차 배정 완료하였습니다.</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 p-5 rounded-xl border border-purple-100">
              <span className="text-xs font-bold text-purple-500 uppercase">동적 보정된 사용자 지정 규칙 수</span>
              <div className="text-2xl font-black text-purple-950 mt-2">{rules.length}개 통제 규칙</div>
              <p className="text-[11px] text-gray-500 mt-1">각 규칙별 데이터 가중치에 기하여 순위를 정렬한 뒤 사문형으로 평준화 배치했습니다.</p>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-5 rounded-xl border border-emerald-100 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-emerald-600 uppercase">최종 엑셀 산출 파일 준비</span>
                <p className="text-xs text-gray-500 mt-1">원본 엑셀 컬럼에 [배정학급] 필드가 유기적으로 합성된 다운로드 템플릿입니다.</p>
              </div>
              <button 
                onClick={downloadResults}
                className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center shadow-sm"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                원본데이터 유지 전체 명단 다운로드
              </button>
            </div>
          </div>

          {/* Validation Metrics */}
          {rules.length > 0 && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center">
                <Sliders className="w-4 h-4 mr-2 text-indigo-500" />
                동적 검증 매트릭스 (학급별 오차 편차 검증)
              </h3>
              
              <div className="space-y-6">
                {rules.map(rule => {
                  const rStat = result.stats.ruleStats[rule.columnName];
                  return (
                    <div key={rule.columnName} className="bg-white p-4 rounded-xl border border-slate-200/70 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md">
                          조정 열: {rule.columnName} ({rule.type === 'numerical' ? '합산치 평준화' : '범주 분포 평준화'})
                        </span>
                        {rule.type === 'numerical' && (
                          <span className="text-xs text-gray-500">
                            전체 전체 평균: <strong className="text-indigo-600">{rStat.global.averages}</strong>
                          </span>
                        )}
                      </div>

                      {rule.type === 'numerical' ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                          {result.activeClassNames.map(cName => {
                            const avgVal = rStat.byClass[cName].averages;
                            // Calculate error percentage from global avg
                            const errorDiff = rStat.global.averages ? Math.abs(avgVal - rStat.global.averages) : 0;
                            return (
                              <div key={cName} className="p-3 bg-slate-50 rounded-lg text-center text-xs">
                                <div className="font-bold text-gray-500">{cName}</div>
                                <div className="text-base font-extrabold text-slate-800 mt-1">{avgVal}</div>
                                <div className="text-[10px] text-gray-400 mt-0.5">오차: {errorDiff.toFixed(2)}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {result.activeClassNames.map(cName => {
                              const counts = rStat.byClass[cName].counts || {};
                              return (
                                <div key={cName} className="p-3 bg-slate-50 rounded-lg text-xs space-y-1">
                                  <div className="font-bold text-indigo-900 border-b pb-1 mb-1.5">{cName} 카테고리 분포</div>
                                  {Object.entries(counts).length === 0 ? (
                                    <div className="text-gray-400 text-[11px]">값 없음</div>
                                  ) : (
                                    Object.entries(counts).map(([category, count]) => (
                                      <div key={category} className="flex justify-between text-gray-600 text-[11px]">
                                        <span>[{category}]</span>
                                        <span className="font-semibold text-gray-900">{count}명</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dispersion Analysis showing old classes to solve matching concentration */}
          {mappings.oldClassKey && (
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center">
                <Users className="w-4 h-4 mr-2 text-indigo-500" />
                기존 학급 출신 분산 분포 검증
              </h3>
              <p className="text-xs text-paragraph text-gray-400 mb-4">
                같은 기존 학급 출신 학생이 특정 반에 너무 몰리지 않도록 회전 분산 로테이션이 이상 없이 반영되었는지 학급별 구성 인원을 표기합니다.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.activeClassNames.map(cName => {
                  const dispersionList = Object.entries(result.stats.dispersionStats[cName]);
                  return (
                    <div key={cName} className="bg-white p-4 rounded-xl border border-slate-100 text-xs">
                      <div className="font-bold text-gray-900 border-b pb-2 mb-2 flex justify-between">
                        <span>{cName}</span>
                        <span className="text-indigo-600 font-extrabold">{result.assignments[cName].length}명 배정</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dispersionList.map(([oldClass, count]) => (
                          <span key={oldClass} className="px-2 py-1 bg-indigo-50/70 border border-indigo-100 text-indigo-850 rounded">
                            기존 [{oldClass}] : <strong className="text-indigo-900">{count}명</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Results Tab View of Students */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <h3 className="text-lg font-bold text-gray-800">배정된 가상 학급 학생 리스트</h3>
              
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setActiveTab('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === 'ALL' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-150'}`}
                >
                  전체보기
                </button>
                {result.activeClassNames.map(cName => (
                  <button 
                    key={cName}
                    onClick={() => setActiveTab(cName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeTab === cName ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-150'}`}
                  >
                    {cName}
                  </button>
                ))}
              </div>
            </div>

            {/* Students Table */}
            <div className="overflow-x-auto border rounded-xl shadow-sm bg-white max-h-[500px]">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-indigo-600 text-white text-xs sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">임시ID</th>
                    <th className="px-4 py-3">이름</th>
                    <th className="px-4 py-3">성별</th>
                    <th className="px-4 py-3">이전 학급</th>
                    <th className="px-4 py-3">배정받은 학급</th>
                    {rules.map(rule => (
                      <th key={rule.columnName} className="px-4 py-3 bg-indigo-700/60 font-semibold">{rule.columnName}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.activeClassNames
                    .filter(cName => activeTab === 'ALL' || activeTab === cName)
                    .flatMap(cName => result.assignments[cName])
                    .map((s, index) => (
                      <tr key={s._id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 text-xs text-gray-400">#{index + 1}</td>
                        <td className="px-4 py-2 font-bold text-gray-900">{s._name}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${s._gender === '남성' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                            {s._gender}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">{s._oldClass}</td>
                        <td className="px-4 py-2 font-bold text-indigo-600">
                          {result.activeClassNames.find(c => result.assignments[c].some(stu => stu._id === s._id))}
                        </td>
                        {rules.map(rule => (
                          <td key={rule.columnName} className="px-4 py-2 text-xs font-mono text-gray-600">
                            {String(s._originalRow[rule.columnName] ?? '-')}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions Bottom */}
          <div className="flex justify-between items-center pt-6 border-t">
            <button 
              onClick={() => setStep(2)}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 font-semibold"
            >
              ← 이전 매핑 및 조건 조정으로
            </button>
            <button 
              onClick={downloadResults}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-sm transition flex items-center shadow-md"
            >
              <Download className="w-4 h-4 mr-1.5" />
              배정 결과 엑셀 다운로드
            </button>
          </div>

        </div>
      )}

    </div>
  );
};
