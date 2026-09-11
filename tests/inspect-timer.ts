import { launchAndLogin } from './helpers/login';
import { clickItemByText } from './helpers/quiz-runner';

async function main() {
  const { browser, page } = await launchAndLogin();

  await clickItemByText(page, 'Phần 1. Luật Trật tự, an toàn giao thông đường bộ');
  await clickItemByText(page, 'Ôn luyện');

  const checkbox = page.getByLabel('Tôi đồng ý với nội quy của trung tâm', { exact: false });
  await checkbox.waitFor({ timeout: 15_000 });
  await checkbox.check();
  await page.getByRole('button', { name: 'Đồng ý' }).click();

  const xacNhanBtn = page.getByRole('button', { name: 'Xác nhận' });
  const appeared = await xacNhanBtn.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  if (appeared) await xacNhanBtn.click();

  const cameraBtn = page.getByRole('button', { name: 'Xác nhận và lưu ảnh' });
  const cameraPresent = await cameraBtn.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  if (cameraPresent) {
    console.log('Waiting for camera check...');
    await cameraBtn.waitFor({ state: 'hidden', timeout: 0 });
  }

  const luyenTatCaBtn = page.getByRole('button', { name: /Luyện tất cả/ });
  await luyenTatCaBtn.waitFor({ state: 'visible', timeout: 0 });
  await luyenTatCaBtn.click();

  await page.waitForFunction(
    () => !document.querySelector('.using-camera-check-active'),
    { timeout: 0 }
  ).catch(() => null);

  // Wait for quiz to render
  await page.locator('[class*="mc-text-question__radio-answer"]').first().waitFor({ timeout: 15_000 });

  // Locate timer — format is HH:MM:SS
  const timerInfo = await page.evaluate(() => {
    const timePattern = /^\d{2}:\d{2}:\d{2}$/;

    const matches = [...document.querySelectorAll('*')]
      .filter(el => el.children.length === 0)
      .filter(el => timePattern.test(el.textContent?.trim() ?? ''))
      .map(el => ({
        tag: el.tagName,
        cls: el.className,
        id: el.id,
        text: el.textContent?.trim(),
        parentTag: el.parentElement?.tagName,
        parentCls: el.parentElement?.className,
        parentHtml: el.parentElement?.outerHTML.slice(0, 300),
      }));

    const timerIcon = document.querySelector('.ti-timer');

    return {
      timeMatches: matches,
      tiTimerParent: timerIcon?.parentElement ? {
        cls: timerIcon.parentElement.className,
        html: timerIcon.parentElement.outerHTML.slice(0, 300),
      } : null,
    };
  });

  console.log('Timer info:', JSON.stringify(timerInfo, null, 2));

  console.log('Browser will stay open. Close the window to exit.');
  await page.waitForEvent('close', { timeout: 0 });
  await browser.close();
}

main().catch(console.error);
