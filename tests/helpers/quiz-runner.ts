import fs from 'fs/promises';
import type { Page } from 'playwright';
import { launchAndLogin } from './login';

const NAV_TIMEOUT = 60_000;
const WAIT_TIMEOUT = 60_000;
const SCAN_TIMEOUT = 60_000;
const NEXT_Q_TIMEOUT = 30_000;

export async function clickItemByText(page: Page, text: string): Promise<void> {
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

export async function answerQuestions(page: Page, outputFile: string): Promise<void> {
  const wrongAnswers: Array<{ question: string; correctAnswer: string }> = [];
  let questionIndex = 0;

  const candidates = [
    '[class*="mc-text-question__radio-answer"]',
    '[class*="answer"]',
    '.ant-radio-wrapper',
    'label:has(input[type="radio"])',
    '[class*="option"]',
    '[class*="choice"]',
    '[role="radio"]',
  ];

  console.log('[answerQuestions] Scanning for answer elements...');
  let answerSelector = '';
  const scanStart = Date.now();
  const deadline = Date.now() + SCAN_TIMEOUT;
  while (Date.now() < deadline) {
    const found = await page.evaluate((sels) => {
      return sels.map(sel => ({
        sel,
        count: document.querySelectorAll(sel).length,
        sample: document.querySelector(sel)
          ? { tag: document.querySelector(sel)!.tagName, cls: document.querySelector(sel)!.className, text: document.querySelector(sel)!.textContent?.trim().slice(0, 80) }
          : null,
      })).filter(r => r.count > 0);
    }, candidates);

    if (found.length > 0) {
      answerSelector = found[0].sel;
      console.log(`[answerQuestions] Answer selector found in ${((Date.now() - scanStart) / 1000).toFixed(1)}s: "${answerSelector}" (${found[0].count} elements)`);
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!answerSelector) {
    console.log('[answerQuestions] No answer elements found after scan. URL:', page.url());
    const html = await page.evaluate(() => document.body.innerHTML);
    await fs.writeFile('D:/playwright-cli-poc/quiz-dom.html', html, 'utf-8');
    console.log('[answerQuestions] DOM saved to quiz-dom.html');
    return;
  }

  while (true) {
    const findStart = Date.now();
    const answers = page.locator(answerSelector);
    const count = await answers.count();
    const findMs = Date.now() - findStart;
    console.log(`[answerQuestions] Answer count: ${count} | find-answer timing: ${findMs}ms`);
    if (count === 0) {
      console.log('[answerQuestions] No answer elements — quiz complete.');
      break;
    }

    const currentNum = await getCurrentQuestionNumber(page);
    console.log(`[answerQuestions] Question counter: ${currentNum}`);
    const total = await page.evaluate(() => {
      const m = (document.body.textContent ?? '').match(/Câu hỏi\s*:\s*\d+\/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    });
    const pick = Math.floor(Math.random() * count);
    console.log(`[answerQuestions] Q${++questionIndex} (${currentNum}/${total}): picking option ${pick + 1} of ${count}`);
    const clickStart = Date.now();
    await answers.nth(pick).click({ force: true, timeout: WAIT_TIMEOUT });
    console.log(`[answerQuestions] Clicked option ${pick + 1} | click timing: ${Date.now() - clickStart}ms`);

    console.log('[answerQuestions] Checking if answer is wrong...');
    const isWrong = await page.getByText('Chưa chính xác', { exact: false })
      .waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
    console.log(`[answerQuestions] Wrong: ${isWrong}`);

    if (isWrong) {
      const question = await page.evaluate(() => {
        const selectors = [
          '[class*="mc-text-question__content"]',
          '[class*="mc-text-question__question"]',
          '[class*="mc-text-question__text"]',
          '[class*="question-content"]',
          '[class*="question-text"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        const firstAnswer = document.querySelector('[class*="mc-text-question__radio-answer"]');
        if (firstAnswer) {
          let el: Element | null = firstAnswer.parentElement;
          while (el) {
            const prev = el.previousElementSibling;
            if (prev?.textContent?.trim()) return prev.textContent.trim();
            el = el.parentElement;
          }
        }
        return '';
      });

      const correctAnswerRaw = await page.getByText('Câu trả lời chính xác là', { exact: false })
        .locator('xpath=following-sibling::*[1] | ..')
        .first().textContent().catch(() => '');
      const correctAnswer = correctAnswerRaw
        .replace(/Câu trả lời chính xác là\s*[:\-]?\s*/i, '')
        .replace(/Chưa chính xác/gi, '')
        .replace(/^\d+[-\.]\s*/, '')
        .trim();

      console.log(`  ✗ Wrong. Q: ${question?.trim().slice(0, 100)}`);
      console.log(`  ✓ Correct: ${correctAnswer?.trim().slice(0, 100)}`);

      wrongAnswers.push({ question: question?.trim() ?? '', correctAnswer: correctAnswer?.trim() ?? '' });
      await fs.writeFile(`${outputFile}.json`, JSON.stringify(wrongAnswers, null, 2), 'utf-8');
      console.log(`[answerQuestions] Saved ${wrongAnswers.length} wrong answers to ${outputFile}.json`);
    }

    const waitMs = (Math.floor(Math.random() * 4) + 7) * 1_000;
    console.log(`[answerQuestions] Waiting ${waitMs / 1000}s before clicking Tiếp...`);
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

    // Also end if timer reaches 00:30:00
    const timerText = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && /^\d{2}:\d{2}:\d{2}$/.test(e.textContent?.trim() ?? ''));
      return el?.textContent?.trim() ?? '';
    });
    console.log(`[answerQuestions] Timer: ${timerText || '(not found)'}`);
    const timerSeconds = timerText
      ? timerText.split(':').reduce((acc, v, i) => acc + parseInt(v) * [3600, 60, 1][i], 0)
      : 0;
    if (timerSeconds >= 3000) {
      console.log(`[answerQuestions] Timer >= 00:50:00 (${timerText}) — ending quiz.`);
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

export async function runQuiz(sectionName: string, outputFile: string, userKey: string = 'user1'): Promise<void> {
  console.log(`[runQuiz] Starting. User: ${userKey} | Section: "${sectionName}" | Output: ${outputFile}.json`);
  const { browser, page } = await launchAndLogin(userKey);

  await clickItemByText(page, sectionName);
  await clickItemByText(page, 'Ôn luyện');

  console.log('[runQuiz] Waiting for terms checkbox...');
  const checkbox = page.getByLabel('Tôi đồng ý với nội quy của trung tâm', { exact: false });
  await checkbox.waitFor({ timeout: WAIT_TIMEOUT });
  await checkbox.check();
  console.log('[runQuiz] Checked: Tôi đồng ý với nội quy của trung tâm');

  await page.getByRole('button', { name: 'Đồng ý' }).click();
  console.log('[runQuiz] Clicked: Đồng ý');

  console.log('[runQuiz] Checking for multi-session modal...');
  const xacNhanBtn = page.getByRole('button', { name: 'Xác nhận' });
  const appeared = await xacNhanBtn.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  if (appeared) {
    await xacNhanBtn.click();
    console.log('[runQuiz] Dismissed multi-session modal: Xác nhận');
  } else {
    console.log('[runQuiz] No multi-session modal.');
  }

  console.log('[runQuiz] Polling for camera check every 3s...');
  while (true) {
    const cameraVisible = await page.getByRole('button', { name: 'Xác nhận và lưu ảnh' })
      .isVisible().catch(() => false);
    if (cameraVisible) {
      console.log('[runQuiz] Camera check detected. Waiting for user to click "Xác nhận và lưu ảnh"...');
      await page.getByRole('button', { name: 'Xác nhận và lưu ảnh' })
        .waitFor({ state: 'hidden', timeout: 0 });
      console.log('[runQuiz] Camera check completed.');
      break;
    }
    const overlayGone = await page.evaluate(() => !document.querySelector('.using-camera-check-active'));
    if (overlayGone) {
      console.log('[runQuiz] No camera check detected. Proceeding.');
      break;
    }
    console.log('[runQuiz] Camera not ready yet, retrying in 3s...');
    await page.waitForTimeout(3_000);
  }
  console.log('[runQuiz] Camera overlay cleared. Entering round loop.');

  let round = 0;
  while (true) {
    round++;
    console.log(`\n[runQuiz] === Round ${round} ===`);

    console.log('[runQuiz] Looking for "Luyện tất cả" button...');
    const luyenTatCaBtn = page.getByRole('button', { name: /Luyện tất cả/ });
    const luyenVisible = await luyenTatCaBtn.waitFor({ state: 'visible', timeout: WAIT_TIMEOUT }).then(() => true).catch(() => false);
    if (luyenVisible) {
      await luyenTatCaBtn.click({ force: true });
      console.log('[runQuiz] Clicked: Luyện tất cả');
    } else {
      console.log('[runQuiz] "Luyện tất cả" not found — quiz may already be active.');
    }

    console.log('[runQuiz] Waiting for answer elements to appear...');
    await page.locator('[class*="mc-text-question__radio-answer"]').first()
      .waitFor({ state: 'visible', timeout: NAV_TIMEOUT }).catch(() => null);
    console.log('[runQuiz] Answer elements visible. URL:', page.url());

    await answerQuestions(page, outputFile);

    console.log(`[runQuiz] Round ${round} complete. Restarting...`);
  }
}
