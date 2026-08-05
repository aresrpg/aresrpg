// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ONE SPELL TRUTH — the class gate (#2220).
//
// Spell facts reach the game from exactly ONE place: the served corpus blob the seed ceremony publishes (the
// `corpus_version` pointer → `spell_corpus.<version>.json`, fetched by frontend `game/data/spell_corpus.js`
// and decoded through `@aresrpg/sim`'s `normalize_chain_spell_corpus`). The pre-split pipeline's generated
// `packages/sdk/src/spells.json` was a SECOND home — 78 spells in the nested-by-class authored dialect, its
// generator (`scripts/seed-content.js`) long extinct — and it had already DIVERGED from the served 240-spell
// corpus: 7 of its spells author a SUMMON effect, an opcode the chain taxonomy deliberately excludes
// (`packages/move/foundation/sources/spell_effect.move` — "SUMMONING is EXCLUDED"), so they never reached
// chain or serving and could never resolve in a real fight.
//
// The artifact is deleted. This gate keeps it dead as a CLASS, not as one path: no bundled spell corpus in the
// tree, no package door to one, and no file anywhere in `packages/`/`api/` that ingests one. It replaces the
// narrow `no-restricted-imports` eslint row (4 files, one specifier) it retires.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const sdk_root = fileURLToPath(new URL('../', import.meta.url))
const repo_root = fileURLToPath(new URL('../../../', import.meta.url))

// A bundled spell corpus reaches code as a MODULE SPECIFIER in exactly two forms: the sdk package door, or a
// path to the generated artifact (static import, dynamic import, require, or a package-manifest target — all
// of them quoted). Prose naming the dead file is history, not ingress, so only quoted specifiers count.
// `fight-spells.json` (the seed-side projection) and `seed/mainnet/spells` (the published corpus, never in
// this repo) are different artifacts — the lookbehind and the `.json` anchor keep them out.
const LEGACY_SPELL_INGRESS = /['"][^'"]*(?<![-\w])spells\.json['"]|['"]@aresrpg\/sdk\/spells['"]/

const CODE_FILE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/
const SKIPPED_DIR = new Set(['node_modules', 'dist', 'build', 'target', '.git'])

const code_files = root => {
  const found = []
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIR.has(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && CODE_FILE.test(entry.name)) found.push(file)
    }
  }
  walk(root)
  return found
}

// POSITIVE CONTROL — the detector must actually detect. A gate that cannot fail proves nothing (an empty scan
// reading as a clean scan is the failure class this repo refuses).
test('the ingress detector sees the real import forms and spares the seed-side names', () => {
  for (const sample of [
    "import spells from '../src/spells.json' with { type: 'json' }",
    "import real_spells from '../../sdk/src/spells.json'",
    "const s = await import('@aresrpg/sdk/spells')",
    '"./spells": "./src/spells.json"',
  ])
    expect(LEGACY_SPELL_INGRESS.test(sample)).toBe(true)

  for (const spared of [
    "from './fight-spells.json'", // the seed-side projection, a different artifact
    "new URL('../../../seed/mainnet/spells', import.meta.url)", // the published corpus directory
    "spells.find((spell) => spell.name_key === 'vanish')",
    'the generated `packages/sdk/src/spells.json` was a second home', // prose/history, never an ingress
    "from '../../fixtures/spell-corpus-20260801a.sample.json'", // a captured SERVED payload
  ])
    expect(LEGACY_SPELL_INGRESS.test(spared)).toBe(false)
})

test('the generated sdk spell corpus is gone from the tree', () => {
  expect(existsSync(path.join(sdk_root, 'src/spells.json'))).toBe(false)
})

test('the sdk exposes no door onto a bundled spell corpus', () => {
  const manifest = JSON.parse(readFileSync(path.join(sdk_root, 'package.json'), 'utf8'))
  const doors = Object.entries(manifest.exports ?? {})
  expect(doors.length).toBeGreaterThan(10) // the manifest was actually read
  expect(manifest.exports['./spells']).toBeUndefined()
  for (const [name, target] of doors)
    expect(LEGACY_SPELL_INGRESS.test(JSON.stringify({ [name]: target }))).toBe(false)
})

// Breadth is the point (~2.6k files read), so this arm buys the I/O time it needs rather than flaking under a
// loaded machine's default 5s.
test(
  'no file in packages/ or api/ ingests a bundled spell corpus',
  () => {
    const files = [...code_files(path.join(repo_root, 'packages')), ...code_files(path.join(repo_root, 'api'))]
    expect(files.length).toBeGreaterThan(2000) // the sweep ran over the real tree, not an empty one

    const offenders = files
      .filter(file => file !== fileURLToPath(import.meta.url))
      .filter(file => LEGACY_SPELL_INGRESS.test(readFileSync(file, 'utf8')))
      .map(file => path.relative(repo_root, file))

    expect(offenders).toEqual([])
  },
  60_000
)
