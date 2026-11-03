import React, { useRef, useState } from 'react';
import { Student } from '../types';

export type SaveRemark = (student: Student, text: string) => Promise<void>;

export const StudentRemark: React.FC<{
  student: Student;
  onSave?: SaveRemark;
  disabledReason?: string;
}> = ({ student, onSave, disabledReason }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState<Student>(student);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const originalSave = useRef<SaveRemark>(onSave);
  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    setMessage('');
    try {
      // 편집 시작 당시 값을 전달하여 다른 화면의 최신 내용을 덮어쓰지 않습니다.
      await originalSave.current(original, draft);
      setEditing(false);
      setFailed(false);
      setMessage('비고가 저장되었습니다.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다. 입력 내용은 유지됩니다.');
    } finally { setSaving(false); }
  };
  return <div className="min-w-44 max-w-md text-xs">
    {editing ? <div className="space-y-2">
      <textarea aria-label={`${student.이름} 비고`} autoFocus rows={4} maxLength={5000}
        value={draft} onChange={e => setDraft(e.target.value)} disabled={saving}
        className="w-full min-w-52 border border-blue-300 rounded-lg p-2 text-slate-800 focus:ring-2 focus:ring-blue-500" />
      {(student.비고 || '') !== (original.비고 || '') && <p role="status" className="text-amber-800">다른 화면에서 비고가 변경되었습니다. 입력 내용은 보존되며 저장 시 충돌을 확인합니다.</p>}
      {!onSave && <p className="text-amber-800">{disabledReason || '현재는 수정할 수 없습니다.'} 입력 내용은 유지됩니다.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={saving || !onSave} onClick={save}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
        <button type="button" disabled={saving} onClick={() => { setEditing(false); setMessage(''); }}
          className="px-3 py-1.5 border border-slate-300 rounded-lg">취소</button>
      </div>
    </div> : onSave ? <button type="button" aria-label={`${student.이름} 비고 편집`} onClick={() => {
      originalSave.current = onSave;
      setOriginal(student); setDraft(student.비고 || ''); setMessage(''); setEditing(true);
    }} className="w-full text-left whitespace-pre-wrap break-words p-2 rounded-lg border border-dashed border-blue-200 hover:bg-blue-50 text-blue-800">
      {student.비고 || '비고 입력'}
    </button> : <span title={disabledReason} className="whitespace-pre-wrap break-words">{student.비고 || '-'}</span>}
    {message && <p role={failed ? 'alert' : 'status'} className={`mt-1 ${failed ? 'text-red-700' : 'text-emerald-700'}`}>{message}</p>}
  </div>;
};
