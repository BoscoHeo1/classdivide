import React, { useId, useRef, useState } from 'react';
import type { Student } from '../types';
import {
  StudentDetails, detailsEqual, getStudentDetails, MAX_SEPARATION_LENGTH, studentDetailsSummary
} from '../utils/studentDetails';

export type SaveStudentDetails = (original: Student, details: StudentDetails) => Promise<void>;

interface StudentDetailsEditorProps {
  student: Student;
  onSave?: SaveStudentDetails;
  disabledReason?: string;
  children?: React.ReactNode;
}

const checkboxFields = ['학습부진', '학생선수', '통합학급', '학부모민원', '쌍둥이', '전출예정'] as const;

export const StudentDetailsEditor: React.FC<StudentDetailsEditorProps> = ({ student, onSave, disabledReason, children }) => {
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState<Student>(student);
  const [draft, setDraft] = useState<StudentDetails>(() => getStudentDetails(student));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const originalSave = useRef<SaveStudentDetails>(onSave);

  const beginEditing = () => {
    originalSave.current = onSave;
    setOriginal({ ...student });
    setDraft(getStudentDetails(student));
    setMessage(''); setFailed(false); setEditing(true);
  };
  const save = async () => {
    if (!onSave || !originalSave.current || saving) return;
    if (draft.분리배정.length > MAX_SEPARATION_LENGTH) {
      setFailed(true); setMessage(`분리배정은 ${MAX_SEPARATION_LENGTH}자 이내로 입력해주세요.`); return;
    }
    setSaving(true); setMessage('');
    try {
      // 편집을 열었던 시점의 값과 저장 함수를 유지하여 동시 수정 충돌을 확인합니다.
      await originalSave.current(original, getStudentDetails(draft));
      setEditing(false); setFailed(false); setMessage('특이사항이 변경되었습니다.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다. 입력 내용은 유지됩니다.');
    } finally { setSaving(false); }
  };

  return <div className="min-w-48 max-w-lg text-xs">
    {editing ? <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
      <fieldset disabled={saving} className="space-y-2">
        <legend className="mb-2 font-semibold text-slate-800">{student.이름} 특이사항</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {checkboxFields.map(field => <label key={field} className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={draft[field]} onChange={event => {
              const checked = event.target.checked;
              setDraft(previous => ({ ...previous, [field]: checked }));
            }} />
            {field === '통합학급' ? '특수(통합)' : field}
          </label>)}
        </div>
        <label className="block text-slate-700" htmlFor={`${formId}-guidance`}>생활지도</label>
        <select id={`${formId}-guidance`} value={draft.생활지도}
          onChange={event => setDraft(previous => ({ ...previous, 생활지도: event.target.value as StudentDetails['생활지도'] }))}
          className="w-full rounded-lg border border-blue-200 bg-white p-2">
          <option value="">해당 없음</option><option value="상">상</option><option value="중">중</option><option value="하">하</option>
        </select>
        <label className="block text-slate-700" htmlFor={`${formId}-twin`}>쌍둥이 배정</label>
        <select id={`${formId}-twin`} value={draft.쌍둥이옵션} disabled={!draft.쌍둥이}
          onChange={event => setDraft(previous => ({ ...previous, 쌍둥이옵션: event.target.value as StudentDetails['쌍둥이옵션'] }))}
          className="w-full rounded-lg border border-blue-200 bg-white p-2 disabled:opacity-50">
          <option value="분리">다른 반으로 분리</option><option value="동일">같은 반으로 배정</option>
        </select>
        <p className="text-[11px] leading-relaxed text-slate-500">실제 쌍둥이 관계는 학급편성의 관계별 그룹에서 별도로 관리합니다.</p>
        <label className="block text-slate-700" htmlFor={`${formId}-separation`}>분리배정</label>
        <textarea id={`${formId}-separation`} rows={3} maxLength={MAX_SEPARATION_LENGTH}
          value={draft.분리배정} onChange={event => setDraft(previous => ({ ...previous, 분리배정: event.target.value }))}
          className="w-full min-w-52 rounded-lg border border-blue-200 bg-white p-2 text-slate-800" />
      </fieldset>
      {!detailsEqual(student, original) && <p role="status" className="text-amber-800">다른 화면에서 특이사항이 변경되었습니다. 입력 내용은 유지되며 저장 시 충돌을 확인합니다.</p>}
      {!onSave && <p className="text-amber-800">{disabledReason || '현재는 수정할 수 없습니다.'} 입력 내용은 유지됩니다.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || !onSave}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">{saving ? '저장 중…' : '특이사항 저장'}</button>
        <button type="button" disabled={saving} onClick={() => { setEditing(false); setMessage(''); }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">취소</button>
      </div>
    </div> : <div className="space-y-2">
      {children ?? <span className="whitespace-pre-wrap break-words text-slate-700">{studentDetailsSummary(student)}</span>}
      {onSave ? <button type="button" onClick={beginEditing} aria-label={`${student.이름} 특이사항 수정`}
        className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">특이사항 수정</button>
        : disabledReason && <p className="text-[11px] text-slate-500">{disabledReason}</p>}
    </div>}
    {message && <p role={failed ? 'alert' : 'status'} className={`mt-1 ${failed ? 'text-red-700' : 'text-emerald-700'}`}>{message}</p>}
  </div>;
};
