import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4197',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } : {}),
  },
  webServer: {
    command: 'npm run dev',
    env: { PORT: '4197', LIVE_AI: '0' },
    url: 'http://127.0.0.1:4197/api/state',
    reuseExistingServer: false,
  },
});
