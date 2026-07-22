// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, mergeConfig } from 'vite'

import frontend_config from '../../packages/frontend/vite.config'

const GOLD = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(GOLD, '..', '..', 'packages', 'frontend')
const CACHE_DIR = process.env.GOLD_VITE_CACHE_DIR
  ? path.resolve(process.env.GOLD_VITE_CACHE_DIR)
  : path.join(FRONTEND, 'node_modules', '.vite')
const FIXTURES = process.env.GOLD_FIXTURES
  ? path.resolve(process.env.GOLD_FIXTURES)
  : path.join(GOLD, 'out', 'fixtures')
const DEPLOYMENT = path.join(FRONTEND, 'src', 'chain', 'deployment')
const FIGHT_SPELLS = path.join(FRONTEND, 'src', 'game', 'screens', 'hud', 'fight-spells')
const LIVING_CORPUS = path.join(FRONTEND, 'src', 'pages', 'encyclopedia', 'living_corpus')
const WORLD_CORPUS = path.join(FRONTEND, 'src', 'pages', 'encyclopedia', 'world_corpus')

const fixtures = new Map([
  [DEPLOYMENT, path.join(FIXTURES, 'deployment.ts')],
  [FIGHT_SPELLS, path.join(FIXTURES, 'fight-spells.js')],
  [LIVING_CORPUS, path.join(FIXTURES, 'living_corpus.ts')],
  [WORLD_CORPUS, path.join(FIXTURES, 'world_corpus.ts')],
])

function localnet_content_plugin() {
  return {
    name: 'gold-localnet-content',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith('.') || source.includes('?gold-base')) return null
      const resolved = path
        .resolve(path.dirname(importer.split('?')[0]), source.split('?')[0])
        .replace(/\.(?:js|jsx|ts|tsx)$/, '')
      return fixtures.get(resolved) ?? null
    },
  }
}

// Only the gold Vite process resolves these content modules to disposable code generated from its seed receipt.
export default defineConfig(
  mergeConfig(frontend_config, {
    cacheDir: CACHE_DIR,
    plugins: [localnet_content_plugin()],
  })
)
