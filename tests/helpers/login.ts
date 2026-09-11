import { firefox } from 'playwright';
import type { Browser, Page } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const config = JSON.parse(readFileSync(resolve(__dirname, '../../config.json'), 'utf-8'));

export async function launchAndLogin(userKey: string = 'user1'): Promise<{ browser: Browser; page: Page }> {
  const { username, password } = config[userKey] ?? (() => { throw new Error(`Unknown user key: "${userKey}"`); })();

  const browser = await firefox.launch({
    headless: false,
    args: ['-width', '1920', '-height', '1080'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  await page.goto('https://hoancau.huelms.com/user/login', { timeout: 120_000 });
  await page.locator('input[name="username"], input[type="text"]').first().fill(username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page.waitForTimeout(1000);
  await page.locator('button[type="submit"], button.btn-primary').first().click({ force: true });
  await page.waitForURL(url => !url.pathname.includes('/user/login'), { timeout: 15_000 });

  console.log(`Login successful. User: ${userKey} | URL: ${page.url()}`);
  return { browser, page };
}
