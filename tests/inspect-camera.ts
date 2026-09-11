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
  await page.waitForTimeout(4000);

  console.log('URL:', page.url());

  // Dump full modal text + button labels
  const modal = await page.evaluate(() => {
    const root = document.querySelector('.ant-modal-root');
    return {
      title: document.querySelector('.ant-modal-confirm-title')?.textContent?.trim(),
      content: document.querySelector('.ant-modal-confirm-content')?.textContent?.trim(),
      buttons: [...document.querySelectorAll('.ant-modal-confirm-btns button')].map(b => b.textContent?.trim()),
      fullText: root?.textContent?.trim().slice(0, 500),
    };
  });
  console.log('Modal:', JSON.stringify(modal, null, 2));

  console.log('Browser will stay open. Close the window to exit.');
  await page.waitForEvent('close', { timeout: 0 });

  await browser.close();
}

main().catch(console.error);
