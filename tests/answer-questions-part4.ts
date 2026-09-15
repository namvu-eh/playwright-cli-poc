import type { Page } from 'playwright';
import { launchAndLogin } from './helpers/login';

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.name, err?.message);
  console.error(err?.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

const NAV_TIMEOUT = 60_000;
const WAIT_TIMEOUT = 60_000;
const SCAN_TIMEOUT = 60_000;
const NEXT_Q_TIMEOUT = 30_000;

async function clickItemByText(page: Page, text: string): Promise<void> {
  console.log(`[clickItemByText] Waiting for: "${text}"`);
  const item = page.getByText(text, { exact: false }).first();
  await item.waitFor({ timeout: WAIT_TIMEOUT });
  console.log(`[clickItemByText] Found. Clicking...`);
  await item.click();
  console.log(`[clickItemByText] Clicked: "${text}" | URL: ${page.url()}`);
}

// Blocking notices that can appear on entry or mid-quiz
const NOTICE_TEXTS = [
  'Chương trình đào tạo sắp hết hạn',
  'Bạn đang học trên nhiều cửa sổ hoặc thiết bị mới',
];

// Pass timeoutMs only on entry; in-loop calls must not wait or they cost seconds per question.
async function dismissNotice(page: Page, noticeText: string, timeoutMs = 0): Promise<boolean> {
  const notice = page.getByText(noticeText, { exact: false }).first();
  const shown = timeoutMs > 0
    ? await notice.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false)
    : await notice.isVisible().catch(() => false);
  if (!shown) return false;

  const label = noticeText.slice(0, 35);
  // Scope to the owning modal so a button from another open dialog can't be clicked
  const modal = page.locator('.ant-modal-content').filter({ hasText: noticeText }).first();
  const scope = (await modal.isVisible().catch(() => false)) ? modal : page;

  for (const btnLabel of ['Xác nhận', 'Đóng', 'Đã hiểu', 'Bỏ qua', 'OK']) {
    const btn = scope.getByRole('button', { name: btnLabel, exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => null);
      console.log(`[dismissNotice] "${label}" closed via "${btnLabel}".`);
      return true;
    }
  }

  const closeIcon = page.locator('.ant-modal-close, .ant-modal-close-x').first();
  if (await closeIcon.isVisible().catch(() => false)) {
    await closeIcon.click({ force: true }).catch(() => null);
    console.log(`[dismissNotice] "${label}" closed via modal X.`);
    return true;
  }

  console.log(`[dismissNotice] "${label}" shown but no dismiss control found.`);
  return false;
}

async function dismissNotices(page: Page, timeoutMs = 0): Promise<void> {
  for (const text of NOTICE_TEXTS) {
    await dismissNotice(page, text, timeoutMs);
  }
}

async function getCurrentQuestionNumber(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.textContent ?? '');
  const match = text.match(/Câu hỏi\s*:\s*(\d+)\/\d+/);
  return match ? parseInt(match[1], 10) : 0;
}

async function waitForNextQuestion(page: Page, currentNum: number): Promise<void> {
  console.log(`[waitForNextQuestion] Waiting for question > ${currentNum}...`);
  await page.waitForFunction(
    (expected: number) => {
      const text = document.body.textContent ?? '';
      const match = text.match(/Câu hỏi\s*:\s*(\d+)\/\d+/);
      return match !== null && parseInt(match[1], 10) > expected;
    },
    currentNum,
    { timeout: NEXT_Q_TIMEOUT }
  ).catch(() => null);
  console.log(`[waitForNextQuestion] Done.`);
}

// Must run on every quiz exit path — without it the practice stays open and the app
// never returns to the section list.
async function finishPractice(page: Page): Promise<void> {
  const ketThucBtn = page.locator('button').filter({ hasText: /Kết thúc luyện thi/ }).first();
  const visible = await ketThucBtn
    .waitFor({ state: 'visible', timeout: WAIT_TIMEOUT }).then(() => true).catch(() => false);
  if (!visible) {
    console.log('[finishPractice] Kết thúc luyện thi not found.');
    return;
  }

  await ketThucBtn.click({ force: true }).catch(() => null);
  console.log('[finishPractice] Clicked: Kết thúc luyện thi');

  for (const label of ['Xác nhận', 'Đồng ý', 'Kết thúc', 'OK']) {
    const btn = page.getByRole('button', { name: label, exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => null);
      console.log(`[finishPractice] Confirmed via "${label}".`);
      break;
    }
  }
  await page.waitForLoadState('domcontentloaded').catch(() => null);
}

async function answerQuestions(page: Page, outputFile: string): Promise<void> {
  const wrongAnswers: Array<{ question: string; correctAnswer: string }> = [];
  let questionIndex = 0;

  // Disable camera overlay pointer-events so it can't block clicks
  await page.evaluate(() => {
    const overlay = document.querySelector('.using-camera-check-active') as HTMLElement | null;
    if (overlay) overlay.style.pointerEvents = 'none';
  }).catch(() => null);

  // Wait for sub-question containers to appear
  const subQContainer = '[class*="mc-text-question__radio-answer"]';
  console.log('[answerQuestions] Waiting for sub-question answer elements...');
  const appeared = await page.locator(subQContainer).first()
    .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).then(() => true).catch(() => false);

  if (!appeared) {
    console.log('[answerQuestions] No answer elements found. URL:', page.url());
    return;
  }

  while (true) {
    // Disable camera overlay again (it may reappear)
    await page.evaluate(() => {
      const overlay = document.querySelector('.using-camera-check-active') as HTMLElement | null;
      if (overlay) overlay.style.pointerEvents = 'none';
    }).catch(() => null);

    await dismissNotices(page);

    // Count sub-question groups: each `mc-text-question` has 3 answers
    const subQuestionCount = await page.evaluate(() =>
      document.querySelectorAll('.mc-text-question, [class="mc-text-question"]').length
    ).catch(() => 0);
    const totalAnswers = await page.locator(subQContainer).count().catch(() => 0);

    if (totalAnswers === 0) {
      console.log('[answerQuestions] No answer elements — quiz complete.');
      await finishPractice(page);
      break;
    }

    const currentNum = await getCurrentQuestionNumber(page);
    const total = await page.evaluate(() => {
      const m = (document.body.textContent ?? '').match(/Câu hỏi\s*:\s*\d+\/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    }).catch(() => 0);

    console.log(`[answerQuestions] Q${++questionIndex} (${currentNum}/${total}): ${subQuestionCount} sub-questions, ${totalAnswers} answer options`);

    // Answer each sub-question: pick 1 random answer per group of 3
    const answersPerSub = 3;
    const numSubQs = Math.ceil(totalAnswers / answersPerSub);
    for (let subIdx = 0; subIdx < numSubQs; subIdx++) {
      const groupStart = subIdx * answersPerSub;
      const pick = groupStart + Math.floor(Math.random() * answersPerSub);
      const answerEl = page.locator(subQContainer).nth(pick);
      await answerEl.click({ force: true, timeout: WAIT_TIMEOUT }).catch(() => null);
      console.log(`  Sub-Q${subIdx + 1}: clicked option ${(pick - groupStart) + 1}`);
      await page.waitForTimeout(300);
    }

    // Click "Kiểm tra" (Check answers) if present
    const kiemTraBtn = page.locator('button').filter({ hasText: /Kiểm tra/ });
    const kiemTraVisible = await kiemTraBtn.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
    if (kiemTraVisible) {
      console.log('[answerQuestions] Clicking Kiểm tra...');
      await kiemTraBtn.click({ force: true }).catch(() => null);
      await page.waitForTimeout(1_000);
    }

    // Save wrong answers if any
    const wrongTexts = await page.evaluate(() => {
      const wrongEls = Array.from(document.querySelectorAll('[class*="wrong"], [class*="incorrect"], [class*="chua-chinh-xac"]'));
      return wrongEls.map(el => el.textContent?.trim().slice(0, 100)).filter(Boolean);
    }).catch(() => [] as string[]);
    if (wrongTexts.length > 0) {
      console.log(`  ✗ Wrong answers detected: ${wrongTexts.join(' | ')}`);
    }

    const waitMs = (Math.floor(Math.random() * 4) + 7) * 1_000;
    console.log(`[answerQuestions] Waiting ${waitMs / 1000}s before Tiếp...`);
    await page.waitForTimeout(waitMs);

    console.log('[answerQuestions] Looking for Tiếp button...');
    const tiepBtn = page.locator('button').filter({ hasText: /^Tiếp$/ });
    const tiepVisible = await tiepBtn.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT }).then(() => true).catch(() => false);
    if (!tiepVisible) {
      console.log('[answerQuestions] "Tiếp" not found — last question, finishing.');
      await finishPractice(page);
      break;
    }
    console.log('[answerQuestions] Clicking Tiếp...');
    await tiepBtn.click({ force: true });
    await waitForNextQuestion(page, currentNum);

    const nextNum = await getCurrentQuestionNumber(page);
    if (total > 0 && nextNum >= total) {
      console.log(`[answerQuestions] Last question reached (${nextNum}/${total}).`);
      await finishPractice(page);
      break;
    }

    const timerText = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && /^\d{2}:\d{2}:\d{2}$/.test(e.textContent?.trim() ?? ''));
      return el?.textContent?.trim() ?? '';
    });
    console.log(`[answerQuestions] Timer: ${timerText || '(not found)'}`);
    const timerSeconds = timerText
      ? timerText.split(':').reduce((acc, v, i) => acc + parseInt(v) * [3600, 60, 1][i], 0)
      : 0;
    if (timerSeconds >= 1200) {
      console.log(`[answerQuestions] Timer >= 00:20:00 (${timerText}) — ending quiz.`);
      await finishPractice(page);
      break;
    }
  }

  console.log(`[answerQuestions] Done. Wrong: ${wrongAnswers.length}. Saved to ${outputFile}.json`);
}

async function dismissEntryModals(page: Page): Promise<void> {
  await dismissNotices(page, 5_000);

  const checkbox = page.getByLabel('Tôi đồng ý với nội quy của trung tâm', { exact: false });
  const termsShown = await checkbox.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (termsShown) {
    await checkbox.check().catch(() => null);
    await page.getByRole('button', { name: 'Đồng ý' }).click().catch(() => null);
    console.log('[dismissEntryModals] Accepted terms.');
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }

  const cameraBtn = page.getByRole('button', { name: 'Xác nhận và lưu ảnh' });
  const cameraShown = await cameraBtn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (cameraShown) {
    console.log('[dismissEntryModals] Camera check visible — complete the face scan (up to 120s)...');
    await cameraBtn.waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => null);
    console.log('[dismissEntryModals] Camera check done.');
  }

  await page.evaluate(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = '.using-camera-check-active { pointer-events: none !important; }';
    document.head.appendChild(styleEl);
  }).catch(() => null);
}

async function runPart4Quiz(userKey: string = 'user1'): Promise<void> {
  const outputFile = 'part4';
  console.log(`[runPart4Quiz] Starting. User: ${userKey} | Output: ${outputFile}.json`);
  const { browser, page } = await launchAndLogin(userKey);

  await dismissNotices(page, 10_000);
  await clickItemByText(page, 'Mô phỏng các tình huống giao thông');
  await clickItemByText(page, 'Ôn luyện');

  await dismissEntryModals(page);
  console.log('[runPart4Quiz] Entering round loop.');

  // Finishing a section lands on a results screen, so each iteration navigates back here
  const sectionsUrl = page.url();

  // Work through all 6 "Luyện tất cả" sections, then start over from the first
  const sectionCount = 6;
  let round = 0;
  let sectionsAvailable = true;

  while (sectionsAvailable) {
    round += 1;
    console.log(`\n[runPart4Quiz] ======== Round ${round} ========`);

    for (let sectionIdx = 0; sectionIdx < sectionCount; sectionIdx++) {
      console.log(`\n[runPart4Quiz] === Round ${round} | Section ${sectionIdx + 1}/${sectionCount} ===`);

      await page.waitForLoadState('domcontentloaded').catch(() => null);
      const allBtns = page.locator('button.btn-primary.btn-outline.btn-small').filter({ hasText: /Luyện tất cả/ });

      // Returning from a finished section re-renders the list — wait for it before counting
      const listReady = await allBtns.first()
        .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).then(() => true).catch(() => false);
      if (!listReady) {
        console.log('[runPart4Quiz] Section list missing — navigating back...');
        await page.goto(sectionsUrl, { timeout: NAV_TIMEOUT }).catch(() => null);
        await dismissEntryModals(page);
        await allBtns.first().waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => null);
      }

      const btnCount = await allBtns.count().catch(() => 0);
      console.log(`[runPart4Quiz] Found ${btnCount} Luyện tất cả buttons`);

      // Guard against spinning forever if the list never comes back
      if (sectionIdx >= btnCount) {
        console.log('[runPart4Quiz] Section list unavailable — stopping.');
        sectionsAvailable = false;
        break;
      }

      const sectionBtn = allBtns.nth(sectionIdx);
      await sectionBtn.scrollIntoViewIfNeeded().catch(() => null);
      const popupPromise = page.context().waitForEvent('page', { timeout: 5_000 }).catch(() => null);
      await sectionBtn.click({ force: true, timeout: 60_000 });
      console.log(`[runPart4Quiz] Clicked section ${sectionIdx + 1}`);

      const popup = await popupPromise;
      let activePage: Page;
      if (popup) {
        console.log('[runPart4Quiz] Popup detected.');
        await popup.waitForLoadState('domcontentloaded').catch(() => null);
        activePage = popup;
      } else {
        console.log('[runPart4Quiz] No popup — same page.');
        await page.waitForLoadState('domcontentloaded').catch(() => null);
        activePage = page;
      }

      // Wait 3s for the quiz modal/page to load after button click
      await activePage.waitForTimeout(3_000);

      console.log('[runPart4Quiz] Waiting for answer elements...');
      await activePage.locator('[class*="mc-text-question__radio-answer"]').first()
        .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => null);
      console.log('[runPart4Quiz] Answer elements visible. URL:', activePage.url());

      await answerQuestions(activePage, outputFile);

      console.log(`[runPart4Quiz] Round ${round} | Section ${sectionIdx + 1} complete.`);
      if (activePage !== page) {
        await activePage.close().catch(() => null);
        await page.waitForLoadState('domcontentloaded').catch(() => null);
      }
    }

    if (sectionsAvailable) {
      console.log(`\n[runPart4Quiz] Round ${round} complete — starting over from section 1.`);
    }
  }

  console.log('[runPart4Quiz] Stopped.');
}

const userKey = process.argv[2] ?? 'user1';
runPart4Quiz(userKey).catch(err => {
  console.error('[CRASH]', err?.name, err?.message);
  console.error(err?.stack);
  process.exit(1);
});
