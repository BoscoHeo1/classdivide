import React from 'react';
import { BookOpen, X, CheckCircle2, Crown, UserCheck, ShieldCheck, Download } from 'lucide-react';

interface ManualModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManualModal: React.FC<ManualModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[88vh] border border-blue-100 flex flex-col overflow-hidden">
        {/* 모달 헤더 */}
        <div className="px-4 sm:px-6 py-4 bg-white border-b border-blue-100 text-[#071747] flex items-center justify-between gap-3 shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <h3 className="font-extrabold text-base sm:text-lg tracking-tight leading-snug">ClassMate Pro 교사용 사용설명서</h3>
              <p className="text-xs leading-5 text-slate-500 mt-1">초등학교 반편성 업무를 가장 쉽고 공정하게 끝내는 가이드</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-white border border-blue-100 hover:bg-blue-50 rounded-xl transition-colors text-slate-500 hover:text-blue-700 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* 모달 본문 */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 bg-blue-50/30 text-slate-600 text-sm leading-6">
          {/* 1. 핵심 2가지 모드 안내 */}
          <div className="space-y-3">
            <h4 className="text-sm sm:text-base font-bold text-[#071747] flex items-center gap-2 border-b border-blue-100 pb-2">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-blue-100 text-blue-700 inline-flex items-center justify-center text-sm">1</span>
              운영 모드 선택 (단독 vs 동학년 협업)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 bg-white border border-blue-100 rounded-xl">
                <span className="font-semibold text-[#172b4d] block text-sm mb-1">💻 단독 모드 (혼자서 엑셀 일괄)</span>
                <p className="text-slate-600 text-sm">
                  학년부장님이나 담당자 한 분이 학년 전체 학생 엑셀 파일을 취합하여 혼자서 빠르게 배정할 때 사용합니다.
                </p>
              </div>
              <div className="p-4 bg-emerald-50/40 border border-emerald-100 rounded-xl">
                <span className="font-semibold text-[#172b4d] block text-sm mb-1">🤝 동학년 실시간 협업 모드 (추천!)</span>
                <p className="text-slate-600 text-sm">
                  동학년 선생님들이 교실에서 각자 접속해 자기 반을 입력하고, 학년부장님이 클릭 한 번으로 배정하여 다 함께 확인합니다.
                </p>
              </div>
            </div>
          </div>

          {/* 2. 동학년 실시간 협업 워크플로우 */}
          <div className="space-y-3">
            <h4 className="text-sm sm:text-base font-bold text-[#071747] flex items-center gap-2 border-b border-blue-100 pb-2">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-blue-100 text-blue-700 inline-flex items-center justify-center text-sm">2</span>
              동학년 실시간 협업 4단계 순서
            </h4>
            <div className="space-y-2">
              <div className="flex gap-3 items-start p-3 bg-white border border-blue-100 rounded-xl">
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0 mt-0.5"><Crown size={14} /></span>
                <div>
                  <strong className="text-[#172b4d] block text-sm">Step 1. 학년부장님의 방 개설</strong>
                  <span className="text-slate-500 text-sm">
                    [방 개설하기]에서 학년명, 방 코드(예: HAEDB5), <strong>관리 비밀번호</strong>를 설정하고 초대링크를 동학년 메신저에 공유합니다.
                  </span>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-white border border-blue-100 rounded-xl">
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0 mt-0.5"><UserCheck size={14} /></span>
                <div>
                  <strong className="text-[#172b4d] block text-sm">Step 2. 담임선생님들의 반별 입력</strong>
                  <span className="text-slate-500 text-sm">
                    선생님들은 방 코드로 접속하여 [1반], [2반] 등 내 반 탭에서 엑셀을 올리거나 학생을 추가한 뒤 [✅ 우리 반 입력 완료]를 누릅니다.
                  </span>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-white border border-blue-100 rounded-xl">
                <span className="p-2 bg-sky-50 text-sky-700 rounded-lg shrink-0 mt-0.5"><CheckCircle2 size={14} /></span>
                <div>
                  <strong className="text-[#172b4d] block text-sm">Step 3. 학년부장님만 최종 배정 실행 (보안 제어)</strong>
                  <span className="text-slate-500 text-sm">
                    일반 선생님은 임의 실행이 차단되며, 학년부장(관리자) 선생님만 모든 반 취합을 확인한 후 <strong>[👑 학급편성 최종 실행]</strong>을 클릭합니다.
                  </span>
                </div>
              </div>

              <div className="flex gap-3 items-start p-3 bg-white border border-blue-100 rounded-xl">
                <span className="p-2 bg-blue-100 text-[#172b4d] rounded-lg shrink-0 mt-0.5"><Download size={14} /></span>
                <div>
                  <strong className="text-[#172b4d] block text-sm">Step 4. 실시간 동시 결과 확인 & 엑셀 다운로드</strong>
                  <span className="text-slate-500 text-sm">
                    실행 즉시 모든 선생님 화면에 배정 명렬표와 <strong>특이사항 매트릭스 대시보드</strong>가 동시에 펼쳐지며, 각자 엑셀로 내려받습니다.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. 5대 스마트 배정 원칙 */}
          <div className="space-y-3">
            <h4 className="text-sm sm:text-base font-bold text-[#071747] flex items-center gap-2 border-b border-blue-100 pb-2">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-blue-100 text-blue-700 inline-flex items-center justify-center text-sm">3</span>
              알고리즘의 5대 배려 기능
            </h4>
            <ul className="list-disc list-outside space-y-1 text-slate-600 text-sm bg-white border border-blue-100 rounded-xl py-3 pr-4 pl-8">
              <li><strong>🌿 특수(통합)학급 정원 감축</strong>: 특수학생이 배치된 학급은 법정 정원(-1명~-2명)을 자동 감축하여 명시합니다.</li>
              <li><strong>⚖️ 생활지도 '상' 특수학급 배려</strong>: 특수학생이 있는 반에는 생활지도 '상' 배치를 최소화하는 안전 가중치가 부여됩니다.</li>
              <li><strong>👥 쌍둥이 선택권</strong>: 쌍둥이를 [분리 배정]할지 [동일 반 배정]할지 학교 방침에 맞게 선택할 수 있습니다.</li>
              <li><strong>🚩 부진 & 운동부 고른 분산</strong>: 기초학력 지원 학생과 학생선수를 전 학급에 균등하게 안배합니다.</li>
              <li><strong>🔄 1:1 맞교환(Swap) 지원</strong>: 배정 후 선생님들 간 협의로 다른 반 학생과 원클릭으로 맞교환할 수 있습니다.</li>
            </ul>
          </div>

          {/* 4. 개인정보 보안 안내 */}
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3 text-[#354c75]">
            <ShieldCheck size={20} className="shrink-0 text-blue-600 mt-0.5" />
            <div className="text-sm">
              <strong className="block text-sm text-[#172b4d] mb-1">모드별 데이터 처리 및 저장 안내</strong>
              단독 모드는 학생 데이터를 브라우저 메모리에서 처리하며 서버에 저장하지 않습니다. 협업 모드는 실시간 협업을 위해 학생 명단, 편성 설정과 결과를 Firebase Realtime Database에 저장·동기화합니다.
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-4 sm:px-6 py-3 bg-white border-t border-blue-100 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            확인하고 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
