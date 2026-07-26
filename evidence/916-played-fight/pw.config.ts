import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '/tmp/aresrpg-lanes/played-926-drive',
  outputDir: '/tmp/aresrpg-lanes/played-926-drive/out',
  timeout: 900_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5260',
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
