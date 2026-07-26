import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '/tmp/aresrpg-lanes/played-931-drive',
  outputDir: '/tmp/aresrpg-lanes/played-931-drive/out',
  timeout: 1_500_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5280',
    // the tactical board is a real GPU surface — headless software GL drops the board build
    headless: false,
    serviceWorkers: 'block',
    trace: 'off',
    video: 'off',
    locale: 'en-US',
    actionTimeout: 60_000,
    navigationTimeout: 180_000,
    viewport: { width: 1600, height: 1000 },
  },
  projects: [{ name: 'chromium-headed', use: { ...devices['Desktop Chrome'] } }],
})
