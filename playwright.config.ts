import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] },
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30_000 },
});
