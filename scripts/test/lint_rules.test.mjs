// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The house lint rules that enforce AGENTS.md code law: each rule admits the lawful shape and reports
// the banned one, and the inherited complexity list can only shrink.
import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, test } from 'bun:test'
import { ESLint, RuleTester } from 'eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

import { INHERITED_COMPLEXITY_FILES } from '../eslint-rules/fp_law.config.mjs'
import fp_law from '../eslint-rules/fp_law.mjs'
import no_silent_failures from '../eslint-rules/no_silent_failures.mjs'
import one_pipeline from '../eslint-rules/one_pipeline.mjs'

RuleTester.describe = describe
RuleTester.it = it
// Resolved lazily: Bun refuses even a reference to it.only under CI.
RuleTester.itOnly = (...args) => it.only(...args)

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } })

// L-N1: developer-chosen bindings are snake_case; library names, components and hooks keep theirs.
tester.run('snake-case', fp_law.rules['snake-case'], {
  valid: [
    { code: `const { blockHeight: block_height } = rpc\nconst FightTimeline = () => null` },
    { code: `import { useState } from 'react'\nconst useFightView = () => useState(0)` },
  ],
  invalid: [
    { code: `const spellCooldown = 5`, errors: [{ messageId: 'camel' }] },
    { code: `const f = (itemCount) => itemCount + 1`, errors: [{ messageId: 'camel' }] },
  ],
})

// L-I1/L-I3: construction is local; the caller's and the module's values are never mutated.
tester.run('no-mutating-methods', fp_law.rules['no-mutating-methods'], {
  valid: [
    { code: `const sorted = [...xs].sort(cmp)` },
    { code: `const index = rows.reduce((map, row) => { map[row.id] = row; return map }, {})` },
  ],
  invalid: [
    { code: `function add_loot(drops) { drops.push(gold()) }`, errors: [{ messageId: 'paramMutation' }] },
    { code: `const cache = []\nexport const remember = (x) => { cache.push(x) }`, errors: [{ messageId: 'mutation' }] },
  ],
})

// L-P3: importing a module is pure; effects fire from entries and lifecycle edges.
tester.run('no-module-scope-effects', fp_law.rules['no-module-scope-effects'], {
  valid: [
    { code: `export const start = () => setInterval(tick, 50)\nconst table = build_table(SPEC)` },
    { code: `fetch('/boot')`, options: [{ allow: ['src/main.'] }], filename: 'packages/frontend/src/main.tsx' },
  ],
  invalid: [
    { code: `const ws = new WebSocket(url)`, errors: [{ messageId: 'moduleEffect' }] },
    {
      code: `setInterval(drain, 1000)`,
      options: [{ allow: ['/dev/'] }],
      filename: `${process.cwd()}/packages/frontend/src/stores/image_queue.ts`,
      errors: [{ messageId: 'moduleEffect' }],
    },
  ],
})

// L-D1: a failure handler re-throws, returns the failure as data, or reports through a sink.
tester.run('no-swallowed-failure', no_silent_failures.rules['no-swallowed-failure'], {
  valid: [
    { code: `try { await send(tx) } catch (e) { throw new ChainError(decode(e)) }` },
    { code: `read_state().catch((e) => ({ ok: false, error: e }))` },
    { code: `save().catch((e) => game_log('inventory', 'save failed', e))` },
  ],
  invalid: [
    {
      code: `load().catch(() => null)`,
      errors: [{ messageId: 'silentFailure', data: { kind: '`.catch()` handler' } }],
    },
    {
      code: `const icon = async (id) => { try { return await fetch_icon(id) } catch (e) { return MISSING } }`,
      errors: [{ messageId: 'silentFailure', data: { kind: 'catch block' } }],
    },
  ],
})

// L-P4: async results re-enter a store as inputs through its reducer, never as direct writes.
tester.run('no-async-store-write', one_pipeline.rules['no-async-store-write'], {
  valid: [
    { code: `setTimeout(() => use_fight.getState().input({ type: 'tick' }, Date.now()), 1000)` },
    { code: `create((set) => ({ load: async () => { set({ loading: true }); await fetch_rows() } }))` },
  ],
  invalid: [
    {
      code: `setTimeout(() => { use_fight.setState({ phase: 'active', winner: 0 }) }, 3000)`,
      errors: [{ messageId: 'asyncWrite', data: { writer: 'use_fight.setState', context: 'a `setTimeout` callback' } }],
    },
    {
      code: `create((set) => ({ refresh: async () => { const rows = await fetch_rows(); set({ rows }) } }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
  ],
})

// L-P4: a store module keeps no second clock.
tester.run('no-settimeout-in-stores', one_pipeline.rules['no-settimeout-in-stores'], {
  valid: [{ code: `setTimeout(() => poll(), 1000)` }],
  invalid: [
    {
      code: `import { create } from 'zustand'\nconst t = setTimeout(fire, 100)`,
      errors: [{ messageId: 'timerInStore', data: { name: 'setTimeout' } }],
    },
  ],
})

// L-C3: the count of inherited hotspot files. Lower it when a file leaves the list; never raise it.
const INHERITED_COMPLEXITY_COUNT = 78

test('the inherited complexity list only shrinks: each listed file exists and still breaches a ceiling', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  expect(new Set(INHERITED_COMPLEXITY_FILES).size).toBe(INHERITED_COMPLEXITY_FILES.length)
  expect(INHERITED_COMPLEXITY_FILES.length).toBe(INHERITED_COMPLEXITY_COUNT)
  expect(INHERITED_COMPLEXITY_FILES.filter((file) => !existsSync(`${root}${file}`))).toEqual([])
  const stock_ceilings = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{js,mjs,ts,tsx}'],
        languageOptions: { parser: tseslint.parser },
        linterOptions: { noInlineConfig: true },
        plugins: { sonarjs },
        rules: { 'sonarjs/cognitive-complexity': ['error', 15], complexity: ['error', 12] },
      },
    ],
  })
  const results = await stock_ceilings.lintFiles([...INHERITED_COMPLEXITY_FILES])
  expect(results.filter(({ errorCount }) => errorCount === 0).map(({ filePath }) => relative(root, filePath))).toEqual(
    []
  )
}, 30_000)
