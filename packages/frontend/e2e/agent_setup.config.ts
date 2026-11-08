// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fileURLToPath as file_url_to_path } from 'node:url'

import { defineConfig } from '@playwright/test'

import base from './playwright.config.ts'

const port = Number(process.env.ARES_AGENT_TEST_PORT ?? 5187)
const root = file_url_to_path(new URL('../../../', import.meta.url))

export default defineConfig({
  ...base,
  testMatch: [
    '**/agent_boot.pw.ts',
    '**/agent_entry.pw.ts',
    '**/agent_setup.pw.ts',
    '**/agent_pairing.pw.ts',
    '**/character_delete.pw.ts',
  ],
  projects: [{ name: 'agent-setup' }],
  workers: 1,
  reporter: [['list']],
  outputDir: '/tmp/ares-agent-test-results',
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: [
    {
      command: 'bun packages/frontend/e2e/fixtures/agent_exchange.ts',
      cwd: root,
      url: 'http://127.0.0.1:5198',
      timeout: 30_000,
    },
    {
      command: `bun run --cwd packages/frontend build --mode test --outDir /tmp/ares-agent-build --emptyOutDir > /tmp/ares-agent-build.log 2>&1 && bun run --cwd packages/frontend preview --host 127.0.0.1 --port ${port} --strictPort --outDir /tmp/ares-agent-build`,
      cwd: root,
      url: `http://127.0.0.1:${port}/e2e/fixtures/agent_pairing.html`,
      timeout: 240_000,
      env: { VITE_SERVER_WS_URL: 'ws://127.0.0.1:5198/' },
    },
  ],
})
