// 실제 Firebase SDK·로컬 에뮬레이터·두 브라우저로 검사하며 운영 요청은 차단합니다.
const assert = require('node:assert/strict');
const path = require('node:path');
const XLSX = require('xlsx');
const { chromium } = require(process.argv[2] || process.env.CLASSDIVIDE_PLAYWRIGHT_PATH || 'playwright');
const project = 'demo-classdivide-remarks';
const code = 'FAKE_COLLAB_UI';
const base = 'http://127.0.0.1:19000';
const wp = `classdivide_workspaces/${code}`;
const results = [];
const pass = text => { results.push(text); console.log('PASS ' + text); };
async function db(method, target, data) {
  const response = await fetch(`${base}/${target}.json?ns=${project}`, {
    method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000)
  });
  assert.ok(response.ok, `로컬 DB ${method} ${target}: ${response.status}`);
  return response.json();
}
const styles = '.hidden{display:none}.whitespace-pre-wrap{white-space:pre-wrap}';
(async () => {
  const { createServer } = await import('vite');
  const testPlugin = {
    name: 'remarks-local-firebase-only', enforce: 'pre',
    transform(source, id) {
      if (id.split('?')[0] !== path.join(process.cwd(), 'firebase.ts').replace(/\\/g, '/')) return;
      assert.ok(source.includes('const firebaseConfig = {') && source.includes('const recoveryFunctions = getFunctions(app, "asia-southeast1");'));
      let transformed = source.replace(/const firebaseConfig = \{[\s\S]*?\n\};/, `const firebaseConfig = { apiKey: 'demo-key', authDomain: '${project}.firebaseapp.com', databaseURL: 'https://${project}.firebaseio.com', projectId: '${project}', appId: 'demo-app' };`)
        .replace('getAuth, signInAnonymously', 'getAuth, signInAnonymously, connectAuthEmulator')
        .replace('getFunctions, httpsCallable', 'getFunctions, httpsCallable, connectFunctionsEmulator')
        .replace('getDatabase, ref, set,', 'getDatabase, connectDatabaseEmulator, ref, set,')
        .replace('const recoveryFunctions = getFunctions(app, "asia-southeast1");', `const recoveryFunctions = getFunctions(app, "asia-southeast1");\nconnectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true });\nconnectDatabaseEmulator(rtdb, '127.0.0.1', 19000);\nconnectFunctionsEmulator(recoveryFunctions, '127.0.0.1', 19501);`);
      assert.ok(!transformed.includes('class-divide-default-rtdb') && !transformed.includes('AIza'), '테스트 변환본에 운영 설정을 남기지 않음');
      return { code: transformed, map: null };
    }
  };
  const server = await createServer({ plugins: [testPlugin], server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
    const errors = [];
    const makeContext = async () => {
      const context = await browser.newContext();
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
      await context.addInitScript(styleText => document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style'); style.textContent = styleText; document.head.appendChild(style);
      }), styles);
      return context;
    };
    const creatorContext = await makeContext();
    const teacherContext = await makeContext();
    const creator = await creatorContext.newPage();
    const teacher = await teacherContext.newPage();
    for (const page of [creator, teacher]) page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${port}/classdivide/?room=${code}`;
    await Promise.all([creator.goto(url), teacher.goto(url)]);
    const uid = page => page.evaluate(async () => (await import('/classdivide/firebase.ts')).ensureAnonymousUser());
    const [creatorUid, teacherUid] = await Promise.all([uid(creator), uid(teacher)]);
    assert.notEqual(creatorUid, teacherUid, '참여 교사는 서로 다른 인증 계정');
    const students = [
      { id: 1000001, 학년: 5, 현학급: 1, 번호: 1, 이름: '학생A', 성별: '남성', 생년월일: '', 학습부진: false, 생활지도: '', 학생선수: false, 통합학급: false, 학부모민원: false, 쌍둥이: false, 전출예정: false, 비고: '원본 A' },
      { id: 1000002, 학년: 5, 현학급: 1, 번호: 2, 이름: '학생B', 성별: '여성', 생년월일: '', 학습부진: false, 생활지도: '', 학생선수: false, 통합학급: false, 학부모민원: false, 쌍둥이: false, 전출예정: false, 비고: '' }
    ];
    const room = { code, name: '가상 협업 검증', hostId: creatorUid, currentClassCount: 1, nextClassCount: 1, reductionCount: 0, placementOrder: 'zigzag', step: 1, updatedAt: 1, classStatus: { 1: { completed: false } } };
    await db('PUT', '', { classdivide_workspaces: { [code]: room }, roomMembers: { [code]: { [creatorUid]: { role: 'admin', active: true, classNum: 0 }, [teacherUid]: { role: 'teacher', active: true, classNum: 1 } } } });
    const openClass = async page => {
      await page.getByRole('heading', { name: '가상 협업 검증', exact: true }).waitFor({ timeout: 45000 });
      await page.getByRole('button', { name: /^1반\s*\d+명/ }).click();
    };
    await Promise.all([openClass(creator), openClass(teacher)]);
    const edit = (page, name = '학생A') => page.getByRole('button', { name: `${name} 비고 편집`, exact: true });
    const row = (page, name = '학생A') => page.getByRole('row').filter({ hasText: name });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(students.map(student => ({
      학년: student.학년, 반: student.현학급, 번호: student.번호, 성명: student.이름, 성별: student.성별, 비고: student.비고
    }))), '학생명단');
    creator.once('dialog', dialog => dialog.accept());
    await creator.locator('input[type=file]').setInputFiles({
      name: 'fictional-collab.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    });
    await edit(creator).waitFor({ timeout: 45000 });
    const uploaded = await db('GET', wp);
    assert.equal(uploaded.classStatus[1].completed, false, '엑셀 업로드만으로 학급을 완료 처리하지 않음');
    assert.equal(uploaded.classInputs[1].length, 2);
    const uploadedStudents = uploaded.classInputs[1];
    pass('실제 엑셀 업로드 직후 완료 상태 취소 없이 비고 편집 가능');
    assert.equal(await edit(teacher).count(), 0);
    pass('실제 익명 계정 두 개로 생성자 편집·참여자 읽기 권한 구분');
    await edit(creator).click();
    await creator.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('협업 저장\n둘째 줄');
    await creator.getByRole('button', { name: '저장', exact: true }).click();
    await creator.getByRole('status').filter({ hasText: '비고가 저장되었습니다.' }).waitFor({ timeout: 45000 });
    await teacher.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes('학생A') && r.textContent.includes('협업 저장\n둘째 줄')));
    assert.ok((await row(teacher).textContent()).includes('협업 저장\n둘째 줄'));
    assert.equal(await edit(creator, '학생B').textContent(), '비고 입력');
    pass('생성자 저장이 실제 DB·서버 함수를 거쳐 다른 참여자 화면에 반영, 다른 학생 보존');
    const savedRoom = await db('GET', wp);
    assert.deepEqual(savedRoom.classInputs[1], uploadedStudents, '원본 명단·비고를 변경하지 않음');
    assert.ok(!JSON.stringify(await db('GET', `classdivide_student_remarks/${code}`)).includes('협업 저장'));
    pass('실제 DB 암호문 저장 및 기존 학생 원본 보존');
    const teacherAttempt = await teacher.evaluate(async roomCode => {
      const f = await import('/classdivide/firebase.ts');
      const ws = await f.getWorkspace(roomCode); const notes = await f.listStudentRemarks(roomCode);
      try { await f.saveStudentRemark(roomCode, ws.students[0], notes[`1:${ws.students[0].id}`], '권한 없는 변경'); return 'unexpected-success'; }
      catch (error) { return error.code; }
    }, code);
    assert.equal(teacherAttempt, 'functions/permission-denied');
    pass('참여자가 화면을 우회하여 서버 함수를 호출해도 저장 거부');
    await creator.reload(); await openClass(creator); await edit(creator).waitFor();
    assert.equal(await edit(creator).textContent(), '협업 저장\n둘째 줄');
    pass('협업 새로고침 후 DB 비고 복원');
    const secondCreator = await creatorContext.newPage();
    secondCreator.on('pageerror', error => errors.push(error.message));
    await secondCreator.goto(url); await openClass(secondCreator); await edit(secondCreator).waitFor();
    assert.equal(await uid(secondCreator), creatorUid);
    await edit(creator).click(); await edit(secondCreator).click();
    await creator.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('먼저 저장한 비고');
    await secondCreator.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('충돌 후 보존할 입력');
    await creator.getByRole('button', { name: '저장', exact: true }).click(); await edit(creator).waitFor();
    const secondSave = secondCreator.getByRole('button', { name: '저장', exact: true });
    await secondSave.waitFor(); await secondSave.click();
    await secondCreator.getByRole('alert').filter({ hasText: '변경되어 덮어쓰지 않았습니다.' }).waitFor();
    assert.equal(await secondCreator.getByRole('textbox', { name: '학생A 비고', exact: true }).inputValue(), '충돌 후 보존할 입력');
    assert.equal(await edit(creator).textContent(), '먼저 저장한 비고');
    await secondCreator.getByRole('button', { name: '취소', exact: true }).click();
    pass('실제 동시 편집 충돌은 서버에서 거부하고 먼저 저장한 비고·나중 입력 보존');
    await edit(creator).click(); await creator.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('통신 실패 후 재시도');
    await creator.route('**/updateStudentRemark', route => route.abort());
    await creator.getByRole('button', { name: '저장', exact: true }).click();
    await creator.getByRole('alert').filter({ hasText: '입력 내용은 유지됩니다.' }).waitFor({ timeout: 45000 });
    assert.equal(await creator.getByRole('textbox', { name: '학생A 비고', exact: true }).inputValue(), '통신 실패 후 재시도');
    await creator.unroute('**/updateStudentRemark');
    await creator.getByRole('button', { name: '저장', exact: true }).click(); await edit(creator).waitFor();
    assert.equal(await edit(creator).textContent(), '통신 실패 후 재시도');
    pass('실제 저장 통신 실패 시 입력 보존·재시도 성공');
    await creator.getByRole('button', { name: '✅ 우리 반 입력 완료로 표시', exact: true }).click();
    await creator.getByRole('button', { name: '완료 상태 취소 (작성중으로)', exact: true }).waitFor();
    await creator.waitForFunction(() => !document.querySelector('button[aria-label="학생A 비고 편집"]'));
    const reuploadFinished = new Promise(resolve => creator.once('dialog', async dialog => {
      await dialog.accept(); resolve();
    }));
    await creator.locator('input[type=file]').setInputFiles({
      name: 'fictional-collab.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    });
    await reuploadFinished;
    assert.equal((await db('GET', wp)).classStatus[1].completed, true, '완료된 반의 재업로드는 마감을 해제하지 않음');
    assert.equal(await edit(creator).count(), 0);
    assert.ok((await row(creator).textContent()).includes('통신 실패 후 재시도'));
    pass('이미 완료된 반의 재업로드는 마감과 기존 비고를 유지');
    const closedAttempt = await creator.evaluate(async roomCode => {
      const f = await import('/classdivide/firebase.ts'); const ws = await f.getWorkspace(roomCode); const notes = await f.listStudentRemarks(roomCode);
      try { await f.saveStudentRemark(roomCode, ws.students[0], notes[`1:${ws.students[0].id}`], '마감 후 변경'); return 'unexpected-success'; }
      catch (error) { return error.code; }
    }, code);
    assert.equal(closedAttempt, 'functions/failed-precondition');
    pass('학급마감 후 편집 UI 및 실제 서버 저장 모두 차단');
    await creator.getByRole('button', { name: '완료 상태 취소 (작성중으로)', exact: true }).click(); await edit(creator).waitFor();
    pass('기존 명시적 마감 취소 후 생성자 편집 재개');
    await creator.getByRole('button', { name: /전체 취합 현황판/ }).click();
    creator.once('dialog', dialog => dialog.accept());
    await creator.getByRole('button', { name: '👑 학급편성 최종 실행 (관리자)', exact: true }).click();
    await creator.getByRole('heading', { name: '학급편성이 완료되었습니다! 🎉', exact: true }).waitFor();
    await teacher.getByRole('heading', { name: '학급편성이 완료되었습니다! 🎉', exact: true }).waitFor();
    const placed = await db('GET', wp);
    assert.equal(placed.step, 3); assert.equal(Object.values(placed.result.assignments).flat().length, 2);
    assert.equal(await edit(creator).count(), 0); assert.ok((await row(creator).textContent()).includes('통신 실패 후 재시도'));
    assert.deepEqual(errors, []);
    pass('기존 편성 실행·두 화면 결과 공유·비고 유지·결과 단계 수정 차단·브라우저 오류 없음');
    console.log(`${results.length}/${results.length} 실제 협업 브라우저 통합 검사 통과`);
  } finally { await browser?.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
