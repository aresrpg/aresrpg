// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RuleTester suite for the ONE-REDUCER tripwire (scripts/eslint-rules/one_pipeline.mjs).
// The invalid fixtures ARE the red: each is a real shape of the async-callback-store-write class,
// headlined by the v1.12.28 prod crash (a setTimeout writing fight state off a stale closure).
// Runs under `bun test scripts/eslint-rules` — the root `test` script's second lane.
import { describe, it } from 'bun:test'
import { RuleTester } from 'eslint'

import plugin from './one_pipeline.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

tester.run('no-async-store-write', plugin.rules['no-async-store-write'], {
  valid: [
    {
      name: 'the correct pattern — a timer dispatches an INPUT through the door',
      code: `setTimeout(() => use_fight.getState().input({ type: 'tick' }, Date.now()), 1000)`,
    },
    {
      name: 'the correct pattern — an event listener dispatches an input',
      code: `events.on('packet/partyInviteNudge', (msg) => use_party.getState().input({ type: 'invite', msg }))`,
    },
    {
      name: 'set BEFORE await is the synchronous half of the action — legal',
      code: `create((set) => ({ load: async () => { set({ loading: true }); await fetch_rows() } }))`,
    },
    {
      name: 'Map.prototype.set inside a timer is not a store write',
      code: `setTimeout(() => cache.set(key, value), 10)`,
    },
    {
      name: 'this.setState is out of scope (not a zustand store)',
      code: `class Legacy { poll() { setTimeout(() => this.setState({ t: 1 }), 5) } }`,
    },
    {
      name: 'a local function named set (not a parameter) is not a store setter',
      code: `const set = (v) => log(v); promise.then(() => set(1))`,
    },
    {
      name: 'useState array destructure is not the zustand shape',
      code: `const [n, setState] = use_state(0); promise.then(() => setState(n + 1))`,
    },
    {
      name: 'a synchronous set in plain module code has no async context',
      code: `export function apply(set) { set({ x: 1 }) }`,
    },
    {
      name: 'allowlisted reducer module — the store’s own machinery owns set',
      code: `export const make = (set) => () => setTimeout(() => set({ x: 1 }), 1)`,
      filename: '/repo/packages/frontend/src/fight/store.js',
      options: [{ allow: ['fight/store.js'] }],
    },
  ],
  invalid: [
    {
      name: 'v1.12.28 crash shape — a setTimeout writing fight state off a stale closure',
      code: `setTimeout(() => { use_fight.setState({ phase: 'active', winner: 0 }) }, 3000)`,
      errors: [{ messageId: 'asyncWrite', data: { writer: 'use_fight.setState', context: 'a `setTimeout` callback' } }],
    },
    {
      name: 'setInterval writing a store',
      code: `setInterval(() => use_world.setState({ t: Date.now() }), 100)`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'window.setTimeout member form',
      code: `window.setTimeout(() => use_x.setState({ a: 1 }), 50)`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'promise .then with the bare creator set',
      code: `create((set) => ({ load: () => fetch_rows().then((rows) => set({ rows })) }))`,
      errors: [{ messageId: 'asyncWrite', data: { writer: 'set', context: 'a promise `.then()` callback' } }],
    },
    {
      name: 'promise .catch writing error state directly',
      code: `create((set) => ({ load: () => fetch_rows().catch(() => set({ error: true })) }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'promise .finally clearing busy directly',
      code: `create((set) => ({ commit: () => send_tx().finally(() => set({ busy: false })) }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'await continuation — set after await resumes on a stale timeline',
      code: `create((set, get) => ({ refresh: async () => { const rows = await fetch_rows(); set({ rows }) } }))`,
      errors: [
        {
          messageId: 'asyncWrite',
          data: { writer: 'set', context: 'an await continuation (code after `await` resumes as a later microtask)' },
        },
      ],
    },
    {
      name: 'await continuation through a transparent sync combinator (.forEach)',
      code: `async function sync_all(set) { await boot(); ids.forEach((id) => set({ id })) }`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'event-emitter listener writing a store (p2p packet → setState)',
      code: `events.on('packet/invite', (msg) => use_party.setState({ incoming: msg }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'DOM listener writing a store',
      code: `element.addEventListener('click', () => use_ui.setState({ open: true }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
    {
      name: 'store-to-store subscribe bridge — a second write door',
      code: `use_fight.subscribe((s) => use_dungeon.setState({ dungeon: project(s) }))`,
      errors: [{ messageId: 'asyncWrite' }],
    },
  ],
})

tester.run('no-settimeout-in-stores', plugin.rules['no-settimeout-in-stores'], {
  valid: [
    {
      name: 'a timer in a non-store module (no zustand import) is fine',
      code: `setTimeout(() => poll(), 1000)`,
    },
    {
      name: 'a store module without timers',
      code: `import { create } from 'zustand'\nexport const use_x = create(() => ({}))`,
    },
    {
      name: 'allowlisted store module',
      code: `import { create } from 'zustand'\nsetTimeout(fire, 100)`,
      filename: '/repo/packages/frontend/src/world-shell/session_gate.js',
      options: [{ allow: ['world-shell/session_gate.js'] }],
    },
  ],
  invalid: [
    {
      name: 'setTimeout inside a zustand store module',
      code: `import { create } from 'zustand'\nconst t = setTimeout(fire, 100)`,
      errors: [{ messageId: 'timerInStore', data: { name: 'setTimeout' } }],
    },
    {
      name: 'setInterval inside a zustand store module',
      code: `import { create } from 'zustand'\nsetInterval(poll, 5000)`,
      errors: [{ messageId: 'timerInStore', data: { name: 'setInterval' } }],
    },
    {
      name: 'window.setTimeout member form inside a vanilla store module',
      code: `import { createStore } from 'zustand/vanilla'\nwindow.setTimeout(fire, 10)`,
      errors: [{ messageId: 'timerInStore', data: { name: 'setTimeout' } }],
    },
  ],
})
