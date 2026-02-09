import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './src/test',
  testMatch: 'e2e.test.ts',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3457',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
