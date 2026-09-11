import fs from 'fs/promises';
import type { Page } from 'playwright';
import { launchAndLogin } from './helpers/login';

async function clickItemByText(page: Page, text: string) {
  const item = page.getByText(text, { exact: false }).first();
  await item.waitFor({ timeout: 15_000 });
  await item.click();
}

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

  await page.getByRole('button', { name: /Luyện tất cả/ }).waitFor({ state: 'visible', timeout: 0 });
  await page.getByRole('button', { name: /Luyện tất cả/ }).click();
  console.log('Clicked Luyện tất cả, waiting for question to load...');

  // Wait until "Tiếp" button appears = question is ready
  await page.getByRole('button', { name: /Tiếp/ }).waitFor({ state: 'visible', timeout: 30_000 });
  console.log('Question loaded! URL:', page.url());

  // Dump full body HTML
  const html = await page.evaluate(() => document.body.innerHTML);
  await fs.writeFile('D:/playwright-cli-poc/quiz-dom.html', html, 'utf-8');
  console.log('DOM saved — size:', html.length);

  console.log('Browser will stay open. Close the window to exit.');
  await page.waitForEvent('close', { timeout: 0 });
  await browser.close();
}

main().catch(console.error);
