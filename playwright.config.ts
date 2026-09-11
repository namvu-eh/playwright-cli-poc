import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'https://hoancau.huelms.com',
    headless: false,
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled', // removes automation flag (issue #2)
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
