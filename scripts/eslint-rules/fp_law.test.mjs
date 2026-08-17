// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RuleTester suite for the FP-LAW tripwires (scripts/eslint-rules/fp_law.mjs).
// The invalid fixtures ARE the red: each is a real shape of the class its law bans
// (docs/CODE_LAW.md L-N1 naming, L-I1/L-I2 mutation, L-P3 module-load purity).
// Runs under `bun test scripts/eslint-rules` — the root `test` script's second lane.
import { describe, it } from 'bun:test'
import { RuleTester } from 'eslint'

import plugin from './fp_law.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

tester.run('snake-case', plugin.rules['snake-case'], {
  valid: [
    { name: 'snake_case declaration', code: `const spell_cooldown = 5` },
    { name: 'single-word lowercase', code: `const grid = make_grid()` },
    { name: 'PascalCase component', code: `const FightTimeline = () => null` },
    { name: 'SCREAMING_SNAKE constant', code: `const GAS_CEILING_SUI = 0.1` },
    {
      name: 'shorthand destructure keeps the library field name',
      code: `const { searchParams } = new URL(href)`,
    },
    {
      name: 'shorthand with default keeps the library field name',
      code: `const { maxRetries = 3 } = options`,
    },
    { name: 'rename TO snake_case is the house move', code: `const { blockHeight: block_height } = rpc` },
    { name: 'imports are the library’s names', code: `import { useState, useSuiClient } from 'lib'` },
    { name: 'snake params and catch', code: `try { run(item_count) } catch (bad_error) { log(bad_error) }` },
    { name: 'underscore throwaway', code: `const [_, second_part] = pair` },
    { name: 'house hook naming', code: `const use_party = create(() => ({}))` },
    { name: 'React hook declaration is the library’s name', code: `function useMinimap() {}` },
    { name: 'React hook const declaration', code: `const useFightView = () => null` },
    { name: 'zustand hook declaration', code: `const useAutoSearch = create(() => ({}))` },
    {
      name: 'object literal keys are API shapes, not bindings',
      code: `const payload = { gasBudget: 100, showEffects: true }`,
    },
  ],
  invalid: [
    { name: 'camelCase const', code: `const spellCooldown = 5`, errors: [{ messageId: 'camel' }] },
    { name: 'camelCase function declaration', code: `function doThing() {}`, errors: [{ messageId: 'camel' }] },
    { name: 'camelCase parameter', code: `const f = (itemCount) => itemCount + 1`, errors: [{ messageId: 'camel' }] },
    {
      name: 'rename to camelCase is a dev choice',
      code: `const { block_height: blockHeight } = rpc`,
      errors: [{ messageId: 'camel' }],
    },
    { name: 'camelCase array pattern', code: `const [firstItem] = xs`, errors: [{ messageId: 'camel' }] },
    {
      name: 'the hook carve-out is declaration-only — a `useX` parameter is still a dev choice',
      code: `const f = (useCache) => useCache`,
      errors: [{ messageId: 'camel' }],
    },
    { name: 'camelCase catch binding', code: `try { f() } catch (rawErr) {}`, errors: [{ messageId: 'camel' }] },
    {
      name: 'camelCase default + rest params',
      code: `function g(maxDepth = 4, ...restArgs) {}`,
      errors: [{ messageId: 'camel' }, { messageId: 'camel' }],
    },
    {
      name: 'underscore-prefixed camelCase is still camelCase',
      code: `let _tempCache = 1`,
      errors: [{ messageId: 'camel' }],
    },
  ],
})

tester.run('no-mutating-methods', plugin.rules['no-mutating-methods'], {
  valid: [
    { name: 'module-scope table construction at load', code: `const table = []\nfor (const x of src) table.push(x)` },
    {
      name: 'local construction inside the same function',
      code: `const f = (items) => { const out = []\nfor (const i of items) out.push(shape(i))\nreturn out }`,
    },
    {
      name: 'sync combinator callbacks are transparent construction',
      code: `function f(items) { const out = []\nitems.forEach((i) => out.push(i))\nreturn out }`,
    },
    { name: 'immediate mutation of a fresh copy', code: `const sorted = [...xs].sort(cmp)` },
    { name: 'slice-then-reverse is copy-first', code: `const r = xs.slice().reverse()` },
    { name: 'call results are fresh by the law itself', code: `const top = Object.entries(counts).sort(by_count)` },
    {
      name: 'reduce accumulators are fold-local construction (L-I3)',
      code: `const grouped = xs.reduce((acc, x) => { acc.push(tag(x))\nreturn acc }, [])`,
    },
    { name: 'Object.assign onto a fresh literal', code: `const merged = Object.assign({}, base, patch)` },
    {
      name: 'delete on a local fresh copy',
      code: `function strip(row) { const copy = { ...row }\ndelete copy.secret\nreturn copy }`,
    },
    { name: 'Map/Set have their own mutable contract', code: `function f() { cache.set(key, value) }` },
    {
      name: 'local built from a call, mutated in the same function',
      code: `function f() { const rows = build_rows()\nrows.sort(cmp)\nreturn rows }`,
    },
  ],
  invalid: [
    {
      name: 'shared mutable module state written from a function',
      code: `const cache = []\nexport const remember = (x) => { cache.push(x) }`,
      errors: [{ messageId: 'mutation' }],
    },
    {
      name: 'mutating a parameter',
      code: `function add_loot(drops) { drops.push(gold()) }`,
      errors: [{ messageId: 'paramMutation' }],
    },
    {
      name: 'sorting a parameter’s member in place',
      code: `const rank = (state) => state.fighters.sort(by_hp)`,
      errors: [{ messageId: 'paramMutation' }],
    },
    {
      name: 'alias of foreign data is still foreign',
      code: `const f = (props) => { const list = props.items\nlist.push(1) }`,
      errors: [{ messageId: 'mutation' }],
    },
    {
      name: 'unresolved global receiver is shared by definition',
      code: `function f(x) { shared_registry.push(x) }`,
      errors: [{ messageId: 'mutation' }],
    },
    {
      name: 'a listener closure mutating captured locals is deferred shared mutation',
      code: `function f() { const out = []\nbus.on('x', () => out.push(1))\nreturn out }`,
      errors: [{ messageId: 'mutation' }],
    },
    {
      name: 'Object.assign onto a parameter',
      code: `function apply(target, patch) { Object.assign(target, patch) }`,
      errors: [{ messageId: 'paramMutation' }],
    },
    {
      name: 'delete on a parameter',
      code: `function scrub(state) { delete state.key }`,
      errors: [{ messageId: 'paramMutation' }],
    },
    {
      name: 'late-assigned binding is not provably fresh',
      code: `function f(c) { let out\nif (c) out = []\nout.push(1) }`,
      errors: [{ messageId: 'mutation' }],
    },
  ],
})

tester.run('no-module-scope-effects', plugin.rules['no-module-scope-effects'], {
  valid: [
    {
      name: 'effects inside an exported function fire from the edge',
      code: `export const start = () => setInterval(tick, 50)`,
    },
    { name: 'module-scope pure computation is fine', code: `const table = build_table(SPEC)` },
    { name: 'reading config is not an effect', code: `const hosts = process.env.HOSTS.split(',')` },
    {
      name: 'a method value is a boundary, not module scope',
      code: `export const api = { start() { setTimeout(poll, 5) } }`,
    },
    { name: 'DOM inside a function', code: `function mount() { return document.createElement('canvas') }` },
    {
      name: 'entry files are the sanctioned edge (allow option)',
      code: `fetch('/boot')`,
      options: [{ allow: ['src/main.'] }],
      filename: 'packages/frontend/src/main.tsx',
    },
  ],
  invalid: [
    {
      name: 'module-scope setInterval (the image_queue.ts class)',
      code: `const q = []\nsetInterval(() => q.pop(), 1000)`,
      errors: [{ messageId: 'moduleEffect' }],
    },
    { name: 'module-scope fetch', code: `fetch('/warm')`, errors: [{ messageId: 'moduleEffect' }] },
    {
      name: 'module-scope listener registration',
      code: `window.addEventListener('resize', on_resize)`,
      errors: [{ messageId: 'moduleEffect' }],
    },
    {
      name: 'module-scope socket construction',
      code: `const ws = new WebSocket(url)`,
      errors: [{ messageId: 'moduleEffect' }],
    },
    {
      name: 'module-scope DOM touch',
      code: `const probe = document.createElement('canvas')`,
      errors: [{ messageId: 'moduleEffect' }],
    },
    {
      name: 'an IIFE is transparent — still module load',
      code: `(async () => { await fetch('/boot') })()`,
      errors: [{ messageId: 'moduleEffect' }],
    },
    {
      name: 'allow fragments match the REPO-relative path — an absolute prefix like ~/dev/… must not exempt (the /dev/ trap, 2026-07-17)',
      code: `setInterval(drain, 1000)`,
      options: [{ allow: ['/dev/'] }],
      filename: `${process.cwd()}/packages/frontend/src/stores/image_queue.ts`,
      errors: [{ messageId: 'moduleEffect' }],
    },
  ],
})
