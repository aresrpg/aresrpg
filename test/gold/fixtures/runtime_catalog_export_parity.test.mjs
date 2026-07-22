// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, test } from 'bun:test'

import { deployment_module, fight_module, living_module, world_module } from './runtime_catalog.mjs'

// TWIN-DRIFT EXPORT-PARITY GATE (P1 recurrence, 2026-07-20). The gold anchor Vite config aliases FOUR real app
// modules to fixtures this file's generator functions emit (vite.anchor.config.ts's `fixtures` map): fight-spells,
// living_corpus, world_corpus, deployment. Every named export a real module declares must land in its emitted
// twin, or the aliased import is a HARD ESM link error at gold boot — the app's error boundary swallows it
// ("Something went wrong"), the world never mounts, and `await_roam_world_mounted` times out at
// fight_mouse_helpers.ts:266, INVISIBLE to every non-browser suite. cd383d92 ("P1 one spell truth") added
// `project_spell_effect` + `project_spell_level` to fight-spells.js; the generator wasn't taught them, and r12d's
// four driven rows (both projects) all died exactly there. 3d17137e fixed fight-spells specifically; THIS gate
// generalizes the check to every aliased pair — the original only ever asserted fight-spells (it "missed this
// class" for the other three) — and compares the ACTUAL emitted module surface via a real dynamic import rather
// than a source-text regex, so a forwarding `export * from` (deployment.ts's pattern, now fight-spells.js's too)
// resolves correctly instead of reading as "nothing exported".

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(here, '..', '..', '..')
const FRONTEND = path.join(REPO, 'packages', 'frontend')

/** Named export identifiers of a live ES module namespace object (`import * as ns`). */
const export_names = (module_namespace) => new Set(Object.keys(module_namespace))

// Emitted twins land in a scratch dir private to this test run — never test/gold/out/fixtures (the anchor rig's
// own disposable output, regenerated per gold boot; this test neither reads nor writes it). MUST live inside
// the repo tree, under the already-gitignored test/gold/out/ (see test/gold/.gitignore): bun resolves the
// fight-spells emission's bare `@aresrpg/sim` specifier by walking UP from the importing file looking for
// node_modules — a pure os.tmpdir() location is outside the workspace and never finds the link.
const scratch_root = path.resolve(here, '..', 'out')
fs.mkdirSync(scratch_root, { recursive: true })
const scratch_dir = fs.mkdtempSync(path.join(scratch_root, 'fixture-parity-'))
afterAll(() => fs.rmSync(scratch_dir, { recursive: true, force: true }))

/** One row per pair the anchor vite config aliases — the real module path, plus a same-shape SYNTHETIC emission
 *  (empty/minimal chain data — write_runtime_catalog's real callers always pass concrete arrays; the export
 *  SURFACE never depends on the data's content, only its shape, which these mirror). */
const pairs = [
  {
    name: 'fight-spells',
    real_path: path.join(FRONTEND, 'src', 'game', 'screens', 'hud', 'fight-spells.js'),
    emitted_filename: 'fight-spells.js',
    emit: () => fight_module([], [], scratch_dir),
  },
  {
    name: 'living_corpus',
    real_path: path.join(FRONTEND, 'src', 'pages', 'encyclopedia', 'living_corpus.ts'),
    emitted_filename: 'living_corpus.ts',
    emit: () => living_module({ items: [], mobs: [], worlds: [] }),
  },
  {
    name: 'world_corpus',
    real_path: path.join(FRONTEND, 'src', 'pages', 'encyclopedia', 'world_corpus.ts'),
    emitted_filename: 'world_corpus.ts',
    emit: () => world_module({ worlds: [] }, {}),
  },
  {
    name: 'deployment',
    real_path: path.join(FRONTEND, 'src', 'chain', 'deployment.ts'),
    emitted_filename: 'deployment.ts',
    emit: () => deployment_module(scratch_dir, []),
  },
]

describe('runtime_catalog fixture twins — export parity with their real app modules', () => {
  for (const pair of pairs) {
    describe(pair.name, () => {
      test('positive control — the real module resolves a non-empty export surface', async () => {
        // include-set law: a "nothing is missing" claim is only trustworthy if the search found real hits first.
        const real = export_names(await import(pair.real_path))
        expect(real.size).toBeGreaterThan(0)
      })

      test('the emitted fixture exports every named export the real module declares', async () => {
        const real = export_names(await import(pair.real_path))
        const emitted_path = path.join(scratch_dir, `${pair.name}--${pair.emitted_filename}`)
        fs.writeFileSync(emitted_path, pair.emit())
        const emitted = export_names(await import(emitted_path))
        const missing = [...real].filter((name) => !emitted.has(name))
        expect(missing).toEqual([])
      })
    })
  }

  test('regression pin — project_spell_effect/level (the exports whose absence boot-crashed r12d)', async () => {
    const fight_spells = pairs.find((pair) => pair.name === 'fight-spells')
    const real = export_names(await import(fight_spells.real_path))
    expect(real.has('project_spell_effect')).toBe(true)
    expect(real.has('project_spell_level')).toBe(true)
  })
})
