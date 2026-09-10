// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { parse } from 'yaml'

import { browser_pins_plugin } from '../../scripts/browser_pins.ts'
import { require_reporting_dsn } from '../frontend/src/reporting_config.ts'

const yaml_plugin = (): Plugin => ({
  name: 'aresrpg-launch-yaml',
  transform: (source, id) =>
    id.endsWith('.yaml') ? { code: `export default ${JSON.stringify(parse(source))}` } : null,
})

export default defineConfig(({ mode }) => {
  const source = loadEnv(mode, import.meta.dirname, '')
  if (mode === 'production') require_reporting_dsn(source)
  return {
    define: {
      'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(source.VERCEL_ENV ?? 'local'),
      'import.meta.env.VITE_RELEASE': JSON.stringify(source.VERCEL_GIT_COMMIT_SHA || source.GITHUB_SHA || ''),
    },
    plugins: [browser_pins_plugin(source.ARES_PINS_FILE, source.VITE_NETWORK), yaml_plugin(), react(), tailwindcss()],
    optimizeDeps: { exclude: ['@aresrpg/sdk', '@aresrpg/frontend'] },
    build: { outDir: 'dist', emptyOutDir: true },
  }
})
