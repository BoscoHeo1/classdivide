'use strict';

const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

const REMARKS_PATH = 'classdivide_student_remarks';
const MAX_REMARK_LENGTH = 5000;
const fail = (code, message) => ({ error: { code, message } });
const DETAIL_FIELDS = ['학습부진', '생활지도', '학생선수', '통합학급', '학부모민원', '쌍둥이', '쌍둥이옵션', '전출예정', '분리배정'];
const BOOLEAN_FIELDS = ['학습부진', '학생선수', '통합학급', '학부모민원', '쌍둥이', '전출예정'];
function studentDetails(student) {
  return Object.fromEntries(DETAIL_FIELDS.map(field => [field,
    BOOLEAN_FIELDS.includes(field) ? student[field] === true
      : field === '생활지도' ? (['상', '중', '하'].includes(student[field]) ? student[field] : '')
        : field === '쌍둥이옵션' ? (student.쌍둥이 === true && student[field] === '동일' ? '동일' : '분리')
          : String(student[field] ?? '')]));
}
function validDetails(value, partial = false) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && (partial || DETAIL_FIELDS.every(field => Object.hasOwn(value, field)))
    && (partial || value.쌍둥이 || value.쌍둥이옵션 === '분리')
    && Object.keys(value).every(field => DETAIL_FIELDS.includes(field)
      && (BOOLEAN_FIELDS.includes(field) ? typeof value[field] === 'boolean'
        : field === '생활지도' ? ['', '상', '중', '하'].includes(value[field])
          : field === '쌍둥이옵션' ? ['동일', '분리'].includes(value[field])
            : typeof value[field] === 'string' && value[field].length <= 1000));
}
const sameDetails = (a, b) => DETAIL_FIELDS.every(field => a[field] === b[field]);

// 행 삭제·정렬로 바뀌는 화면 ID를 제외하고 이름·원래 번호 등으로 학생을 구분합니다.
function studentIdentity(student) {
  return createHash('sha256').update(JSON.stringify([
    student.현학급, String(student.이름 || ''), String(student.번호 ?? ''),
    String(student.생년월일 || ''), String(student.학년 ?? '')
  ])).digest('hex');
}

function studentsInRoom(room) {
  if (room.classInputs && typeof room.classInputs === 'object') {
    return Object.entries(room.classInputs).sort(([a], [b]) => Number(a) - Number(b))
      .flatMap(([classNum, rows]) => Object.values(rows || {}).filter(Boolean).map((student, index) => ({
        ...student, id: Number(classNum) * 1000000 + index + 1, 현학급: Number(classNum)
      })));
  }
  // 과거 학생 배열만 있는 방도 기존 자료를 바꾸거나 삭제하지 않고 읽습니다.
  return Object.values(room.students || {}).filter(Boolean);
}

function memberAccess(root, code, uid) {
  const room = root.classdivide_workspaces?.[code];
  const member = root.roomMembers?.[code]?.[uid];
  if (!room || member?.active !== true || !['admin', 'teacher'].includes(member.role)) {
    return fail('permission-denied', '이 방의 승인된 권한이 필요합니다.');
  }
  return { room, member };
}

function encryptionKey(getKey) {
  const secret = getKey();
  const key = typeof secret === 'string' ? Buffer.from(secret, 'base64') : Buffer.alloc(0);
  if (key.length !== 32 || key.toString('base64') !== secret) {
    throw new Error('비고 암호화 설정을 확인해주세요.');
  }
  return key;
}

// 방·학급·학생 지문을 암호문에 결합하여 다른 학생으로 복사된 암호문도 거부합니다.
function aad(code, classNum, identity, version, format) {
  return Buffer.from(JSON.stringify(format === undefined ? [code, classNum, identity, version] : [code, classNum, identity, version, format]));
}
function recordPayload(saved, code, student, getKey) {
  if (!saved) return { text: String(student.비고 ?? ''), details: {} };
  const decoded = decrypt(saved, code, student.현학급, studentIdentity(student), getKey);
  // 기존 문자열 암호문은 유지하고 새 항목 수정본만 버전이 있는 봉투로 구분합니다.
  if (saved.format === undefined) return { text: decoded, details: {} };
  const payload = JSON.parse(decoded);
  if (saved.format !== 2 || payload.schema !== 'student-details-v1'
    || typeof payload.text !== 'string' || !validDetails(payload.details, true)) {
    throw new Error('저장된 학생 특이사항을 확인하지 못했습니다.');
  }
  return payload;
}
function encrypt(text, code, classNum, identity, version, getKey, format) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(getKey), iv);
  cipher.setAAD(aad(code, classNum, identity, version, format));
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { identity, version, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decrypt(record, code, classNum, identity, getKey) {
  if (record.identity !== identity || !Number.isSafeInteger(record.version) || record.version < 1) {
    throw new Error('저장된 비고 정보를 확인하지 못했습니다.');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(getKey), Buffer.from(record.iv, 'base64'));
  decipher.setAAD(aad(code, classNum, identity, record.version, record.format));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function savedRecord(root, code, student, getKey) {
  const identity = studentIdentity(student);
  const saved = root[REMARKS_PATH]?.[code]?.[student.현학급]?.[identity];
  const payload = recordPayload(saved, code, student, getKey);
  return {
    identity,
    version: saved?.version || 0,
    text: payload.text,
    details: { ...studentDetails(student), ...payload.details }
  };
}

function listRemarks(root, code, uid, getKey) {
  const access = memberAccess(root, code, uid);
  if (access.error) return access;
  const notes = {};
  const identities = new Set();
  for (const student of studentsInRoom(access.room).filter(student =>
    access.member.role === 'admin' || (Number.isSafeInteger(access.member.classNum) && student.현학급 === access.member.classNum))) {
    const key = `${student.현학급}:${student.id}`;
    const identity = studentIdentity(student);
    if (notes[key] || identities.has(identity)) return fail('failed-precondition', '중복된 학생 식별자가 있습니다. 학급 명단을 확인해주세요.');
    identities.add(identity);
    notes[key] = savedRecord(root, code, student, getKey);
  }
  return { notes };
}

function updateRemark(root, code, uid, input, getKey, now = Date.now()) {
  const access = memberAccess(root, code, uid);
  if (access.error) return access;
  const { room, member } = access;
  const { classNum, studentId, identity, expectedVersion, expectedText, text } = input || {};
  // 담당 학급은 요청·브라우저 정보가 아니라 승인된 서버 회원 정보로 판단합니다.
  if (member.role !== 'admin' && !(member.role === 'teacher'
    && Number.isSafeInteger(member.classNum) && member.classNum === classNum)) {
    return fail('permission-denied', '관리자는 전체 학급을, 담임교사는 승인된 본인 학급만 수정할 수 있습니다.');
  }
  const editsDetails = Object.hasOwn(input || {}, 'details');
  if (!Number.isSafeInteger(classNum) || classNum < 1 || classNum > room.currentClassCount
    || !Number.isSafeInteger(studentId) || typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
    || typeof expectedText !== 'string' || typeof text !== 'string' || text.length > MAX_REMARK_LENGTH
    || (editsDetails && (!validDetails(input.details) || !validDetails(input.expectedDetails)))) {
    return fail('invalid-argument', `학생 정보를 확인하고 비고를 ${MAX_REMARK_LENGTH}자 이내로 입력해주세요.`);
  }
  if (room.step !== 1 || room.classStatus?.[classNum]?.completed === true) {
    return fail('failed-precondition', '마감된 학급의 비고는 수정할 수 없습니다.');
  }
  const students = studentsInRoom(room);
  if (new Set(students.map(studentIdentity)).size !== students.length) {
    return fail('failed-precondition', '중복된 학생 식별자가 있습니다. 학급 명단을 확인해주세요.');
  }
  const matches = students.filter(student => student.현학급 === classNum && student.id === studentId);
  if (matches.length !== 1 || studentIdentity(matches[0]) !== identity) {
    return fail('aborted', '학생 명단이 변경되었습니다. 최신 명단을 확인한 뒤 다시 수정해주세요.');
  }
  const current = savedRecord(root, code, matches[0], getKey);
  if (current.version !== expectedVersion || current.text !== expectedText
    || (editsDetails && !sameDetails(current.details, input.expectedDetails))) {
    return fail('aborted', '다른 화면에서 비고가 변경되었습니다. 입력한 내용을 보관하고 최신 비고를 확인해주세요.');
  }
  const groups = Object.values(room.twinGroups || {}).filter(Boolean);
  if (editsDetails && (current.details.쌍둥이 !== input.details.쌍둥이 || current.details.쌍둥이옵션 !== input.details.쌍둥이옵션)
    && groups.some(group => Object.values(group.studentIds || {}).map(Number).includes(studentId))) {
    return fail('failed-precondition', '쌍둥이 그룹에 포함된 학생입니다. 전체 취합 현황판에서 그룹을 먼저 정리한 뒤 쌍둥이 항목을 수정해주세요.');
  }
  const version = expectedVersion + 1;
  if (!Number.isSafeInteger(version)) return fail('failed-precondition', '저장된 비고 버전을 확인해주세요.');
  // 검증과 암호화를 모두 마친 뒤 해당 학생의 비고와 동기화 시각만 바꿉니다.
  const previous = root[REMARKS_PATH]?.[code]?.[classNum]?.[identity];
  const payload = recordPayload(previous, code, matches[0], getKey);
  const baseline = studentDetails(matches[0]);
  // 바뀐 항목만 암호화 덮어쓰기로 보관해 미수정 항목의 후속 엑셀 입력을 보존합니다.
  const detailsPatch = editsDetails
    ? Object.fromEntries(DETAIL_FIELDS.filter(field => input.details[field] !== baseline[field]).map(field => [field, input.details[field]]))
    : payload.details;
  const structured = editsDetails || previous?.format === 2;
  const record = encrypt(structured ? JSON.stringify({ schema: 'student-details-v1', text, details: detailsPatch }) : text,
    code, classNum, identity, version, getKey, structured ? 2 : undefined);
  if (structured) record.format = 2;
  root[REMARKS_PATH] ||= {};
  root[REMARKS_PATH][code] ||= {};
  root[REMARKS_PATH][code][classNum] ||= {};
  root[REMARKS_PATH][code][classNum][identity] = record;
  room.updatedAt = Math.max(now, Number(room.updatedAt || 0) + 1);
  return { text, version, identity, details: { ...baseline, ...detailsPatch } };
}

module.exports = { REMARKS_PATH, MAX_REMARK_LENGTH, studentIdentity, studentDetails, studentsInRoom, listRemarks, updateRemark };
