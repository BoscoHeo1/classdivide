// 가상 학생만 사용하는 로컬 브라우저 검사입니다. 외부 요청은 모두 차단합니다.
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { chromium } = require(process.argv[2] || process.env.CLASSDIVIDE_PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    const executablePath = process.argv[3] || process.env.CLASSDIVIDE_CHROMIUM_PATH;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const open = async () => {
      await page.goto(`http://127.0.0.1:${port}/classdivide/`);
      // CDN 차단 상태에서도 기존 단계별 숨김을 적용합니다.
      await page.addStyleTag({ content: '.hidden{display:none}.whitespace-pre-wrap{white-space:pre-wrap}' });
      await page.getByText('일반모드 작업은 이 탭에만 암호화 저장됩니다.', { exact: false }).waitFor();
    };
    await open();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 학년: 5, 반: 1, 번호: 1, 성명: '학생A', 성별: '남성', 비고: '기존 비고' },
      { 학년: 5, 반: 1, 번호: 2, 성명: '학생B', 성별: '여성', 비고: '' }
    ]), '학생명단');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'fictional.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) });
    const editA = () => page.getByRole('button', { name: '학생A 비고 편집', exact: true }).first();
    const editB = () => page.getByRole('button', { name: '학생B 비고 편집', exact: true }).first();
    await editA().waitFor();
    assert.equal(await editA().innerText(), '기존 비고');
    await editB().click();
    await page.getByRole('textbox', { name: '학생B 비고', exact: true }).fill('새 비고\n둘째 줄');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '비고가 저장되었습니다.' }).waitFor();
    assert.equal(await editB().innerText(), '새 비고\n둘째 줄');
    assert.equal(await editA().innerText(), '기존 비고');
    console.log('PASS 빈 비고 입력·다중행 저장·다른 학생 보존');
    await editA().click();
    await page.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('취소할 내용');
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(await editA().innerText(), '기존 비고');
    console.log('PASS 취소 시 이전 비고 보존');
    await page.reload();
    await page.addStyleTag({ content: '.hidden{display:none}.whitespace-pre-wrap{white-space:pre-wrap}' });
    await editB().waitFor();
    assert.equal(await editB().innerText(), '새 비고\n둘째 줄');
    console.log('PASS 새로고침 후 명단·비고 복원');
    await editA().click();
    await page.getByRole('textbox', { name: '학생A 비고', exact: true }).fill('실패 후 재시도');
    await page.evaluate(() => { window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'classdivide_standalone_encrypted_v1') throw new DOMException('시험 저장 실패', 'QuotaExceededError'); return window.__setItem.call(this, key, value); }; });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '비고를 저장하지 못했습니다.' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '학생A 비고', exact: true }).inputValue(), '실패 후 재시도');
    await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await editA().waitFor();
    assert.equal(await editA().innerText(), '실패 후 재시도');
    console.log('PASS 저장 실패 안내·입력 보존·재시도 성공');
    await editB().click();
    await page.getByRole('textbox', { name: '학생B 비고', exact: true }).fill('');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await editB().waitFor();
    assert.equal(await editB().innerText(), '비고 입력');
    await page.reload();
    await page.addStyleTag({ content: '.hidden{display:none}.whitespace-pre-wrap{white-space:pre-wrap}' });
    await editB().waitFor();
    assert.equal(await editB().innerText(), '비고 입력');
    console.log('PASS 빈 문자열 저장·새로고침 유지');
    await page.getByRole('button', { name: '다음 단계', exact: true }).click();
    await page.getByRole('heading', { name: '2단계: 편성 규칙 설정', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS 브라우저 실행 오류 없음');
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
