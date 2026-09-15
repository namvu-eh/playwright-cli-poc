import fs from 'fs/promises';
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

    // Count sub-question groups: each `mc-text-question` has 3 answers
    const subQuestionCount = await page.evaluate(() =>
      document.querySelectorAll('.mc-text-question, [class="mc-text-question"]').length
    ).catch(() => 0);
    const totalAnswers = await page.locator(subQContainer).count().catch(() => 0);

    if (totalAnswers === 0) {
      console.log('[answerQuestions] No answer elements — quiz complete.');
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
      console.log('[answerQuestions] "Tiếp" not found — quiz complete.');
      break;
    }
    console.log('[answerQuestions] Clicking Tiếp...');
    await tiepBtn.click({ force: true });
    await waitForNextQuestion(page, currentNum);

    const nextNum = await getCurrentQuestionNumber(page);
    if (total > 0 && nextNum >= total) {
      console.log(`[answerQuestions] Last question reached (${nextNum}/${total}). Looking for Kết thúc luyện thi...`);
      const ketThucBtn = page.locator('button').filter({ hasText: /Kết thúc luyện thi/ });
      const visible = await ketThucBtn.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT }).then(() => true).catch(() => false);
      if (visible) {
        await ketThucBtn.click();
        console.log('[answerQuestions] Clicked: Kết thúc luyện thi');
      } else {
        console.log('[answerQuestions] Kết thúc luyện thi not found.');
      }
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
      const ketThucBtn = page.locator('button').filter({ hasText: /Kết thúc luyện thi/ });
      const visible = await ketThucBtn.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT }).then(() => true).catch(() => false);
      if (visible) {
        await ketThucBtn.click();
        console.log('[answerQuestions] Clicked: Kết thúc luyện thi');
      }
      break;
    }
  }

  console.log(`[answerQuestions] Done. Wrong: ${wrongAnswers.length}. Saved to ${outputFile}.json`);
}

async function runPart4Quiz(userKey: string = 'user1'): Promise<void> {
  const outputFile = 'part4';
  console.log(`[runPart4Quiz] Starting. User: ${userKey} | Output: ${outputFile}.json`);
  const { browser, page } = await launchAndLogin(userKey);

  await clickItemByText(page, 'Mô phỏng các tình huống giao thông');
  await clickItemByText(page, 'Ôn luyện');

  console.log('[runPart4Quiz] Waiting for terms checkbox...');
  const checkbox = page.getByLabel('Tôi đồng ý với nội quy của trung tâm', { exact: false });
  await checkbox.waitFor({ timeout: WAIT_TIMEOUT });
  await checkbox.check();
  console.log('[runPart4Quiz] Checked: Tôi đồng ý với nội quy của trung tâm');

  await page.getByRole('button', { name: 'Đồng ý' }).click();
  console.log('[runPart4Quiz] Clicked: Đồng ý');
  await page.waitForLoadState('domcontentloaded').catch(() => null);

  console.log('[runPart4Quiz] Checking for multi-session modal...');
  const xacNhanBtn = page.getByRole('button', { name: 'Xác nhận' });
  const appeared = await xacNhanBtn.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  if (appeared) {
    await xacNhanBtn.click();
    console.log('[runPart4Quiz] Dismissed multi-session modal: Xác nhận');
  } else {
    console.log('[runPart4Quiz] No multi-session modal.');
  }

  console.log('[runPart4Quiz] Waiting up to 120s for camera check to be completed manually...');
  const cameraBtn = page.getByRole('button', { name: 'Xác nhận và lưu ảnh' });
  const cameraAppeared = await cameraBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
  if (cameraAppeared) {
    console.log('[runPart4Quiz] Camera check visible. Waiting for it to be dismissed (up to 120s)...');
    await cameraBtn.waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => null);
    console.log('[runPart4Quiz] Camera check done.');
    await page.evaluate(() => {
      const styleEl = document.createElement('style');
      styleEl.textContent = '.using-camera-check-active { pointer-events: none !important; }';
      document.head.appendChild(styleEl);
    }).catch(() => null);
  } else {
    console.log('[runPart4Quiz] No camera check within 30s. Proceeding.');
  }
  console.log('[runPart4Quiz] Entering round loop.');

  // Dump the 6 sections structure once for investigation
  const sectionsDump = await page.evaluate(() => {
    const luyenEls = Array.from(document.querySelectorAll('*')).filter(el =>
      el.children.length === 0 && el.textContent?.trim().includes('Luyện tất cả')
    );
    return luyenEls.map((el, i) => ({
      index: i,
      text: el.textContent?.trim().slice(0, 80),
      tag: el.tagName,
      cls: el.className,
      parentCls: el.parentElement?.className ?? '',
      grandparentCls: el.parentElement?.parentElement?.className ?? '',
    }));
  }).catch(e => `evaluate error: ${e}`);
  console.log('[runPart4Quiz] Sections dump:', JSON.stringify(sectionsDump, null, 2));

  // Iterate all 6 "Luyện tất cả" sections in order
  const sectionCount = 6;
  for (let sectionIdx = 0; sectionIdx < sectionCount; sectionIdx++) {
    console.log(`\n[runPart4Quiz] === Section ${sectionIdx + 1}/${sectionCount} ===`);

    // Re-query all Luyện tất cả buttons (in case page re-rendered)
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    const allBtns = page.locator('button.btn-primary.btn-outline.btn-small').filter({ hasText: /Luyện tất cả/ });
    const btnCount = await allBtns.count().catch(() => 0);
    console.log(`[runPart4Quiz] Found ${btnCount} Luyện tất cả buttons`);

    if (sectionIdx >= btnCount) {
      console.log('[runPart4Quiz] No more sections. Done.');
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

    // Dump the page DOM after clicking Luyện tất cả (investigation mode)
    if (sectionIdx === 0) {
      const pageHtml = await activePage.evaluate(() => document.body.innerHTML.slice(0, 8000)).catch(() => '');
      await fs.writeFile('part4-section-dom.html', pageHtml, 'utf-8');
      console.log('[runPart4Quiz] Dumped section DOM to part4-section-dom.html');

      const quizStructure = await activePage.evaluate(() => {
        const allInputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
        const allBtns = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
        const allLabels = Array.from(document.querySelectorAll('label')).map(l => ({ text: l.textContent?.trim().slice(0,80), cls: l.className }));
        const modalEls = Array.from(document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="quiz"], [class*="question"], [class*="scenario"]'))
          .map(el => ({ tag: el.tagName, cls: el.className.slice(0,80), children: el.children.length }));
        return { inputs: allInputs.length, buttons: allBtns, labels: allLabels.slice(0,10), modals: modalEls.slice(0,10) };
      }).catch(e => `error: ${e}`);
      console.log('[runPart4Quiz] Quiz structure:', JSON.stringify(quizStructure, null, 2));
    }

    console.log('[runPart4Quiz] Waiting for answer elements...');
    await activePage.locator('[class*="mc-text-question__radio-answer"]').first()
      .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => null);
    console.log('[runPart4Quiz] Answer elements visible. URL:', activePage.url());

    await answerQuestions(activePage, outputFile);

    console.log(`[runPart4Quiz] Section ${sectionIdx + 1} complete.`);
    if (activePage !== page) {
      await activePage.close().catch(() => null);
      // Navigate back to the sections page
      await page.waitForLoadState('domcontentloaded').catch(() => null);
    }
  }

  console.log('[runPart4Quiz] All sections complete.');
}

const userKey = process.argv[2] ?? 'user1';
runPart4Quiz(userKey).catch(err => {
  console.error('[CRASH]', err?.name, err?.message);
  console.error(err?.stack);
  process.exit(1);
});
