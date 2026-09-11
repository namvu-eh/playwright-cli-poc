import { launchAndLogin } from './helpers/login';

async function main() {
  const { browser, page } = await launchAndLogin();

  console.log('Browser will stay open. Close the window to exit.');
  await page.waitForEvent('close', { timeout: 0 });

  await browser.close();
}

main().catch(console.error);
