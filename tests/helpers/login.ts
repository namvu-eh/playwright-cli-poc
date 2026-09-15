import type { BrowserContext, Page } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// @ts-ignore - patchright is a drop-in Playwright replacement with CDP leaks patched out
import { chromium } from 'patchright';

const config = JSON.parse(readFileSync(resolve(__dirname, '../../config.json'), 'utf-8'));

const PROFILE_DIR = resolve(__dirname, '../../.chrome-profile');

export async function launchAndLogin(userKey: string = 'user1'): Promise<{ browser: BrowserContext; page: Page }> {
  const { username, password } = config[userKey] ?? (() => { throw new Error(`Unknown user key: "${userKey}"`); })();

  // patchright requires launchPersistentContext with no custom args and no viewport override;
  // custom flags like --disable-blink-features=AutomationControlled are themselves detectable.
  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  await page.goto('https://hoancau.huelms.com/user/login', { timeout: 120_000 });

  // A logged-in profile redirects away from /user/login, so key off the form, not the URL
  const userInput = page.locator('input[name="username"], input[type="text"]').first();
  const needsLogin = await userInput.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
  if (!needsLogin) {
    console.log(`Already logged in. User: ${userKey} | URL: ${page.url()}`);
    return { browser: context, page };
  }

  await userInput.fill(username);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await page.waitForTimeout(1000);
  await page.locator('button[type="submit"], button.btn-primary').first().click();
  await page.waitForURL(url => !url.pathname.includes('/user/login'), { timeout: 15_000 });

  console.log(`Login successful. User: ${userKey} | Browser: Chrome (patchright) | URL: ${page.url()}`);
  return { browser: context, page };
}
