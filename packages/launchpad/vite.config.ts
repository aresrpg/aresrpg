// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { parse } from 'yaml'

import { browser_pins_plugin } from '../../scripts/browser_pins.ts'

const yaml_plugin = (): Plugin => ({
  name: 'aresrpg-launch-yaml',
  transform: (source, id) =>
    id.endsWith('.yaml') ? { code: `export default ${JSON.stringify(parse(source))}` } : null,
})

export default defineConfig({
  plugins: [browser_pins_plugin(), yaml_plugin(), react(), tailwindcss()],
  optimizeDeps: { exclude: ['@aresrpg/sdk', '@aresrpg/frontend'] },
  build: { outDir: 'dist', emptyOutDir: true },
})
