// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #609 — ONLY A VICTORY CONSUMES A GROUP. A lost open-world fight must give its claimed mob group back
// (`fight::release_group`), or the world's mob population drops by one group permanently, every defeat.
// The chain door and the SDK compose have been restored; these tests pin the CLIENT half: the claimed group
// survives as a session fact, and settlement hands it to the settle PTB on a defeat — and never on a win.
import { describe, test, expect, spyOn, afterAll } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'

import { lost_group_of } from './lost_group.js'

// The settlement graph reaches auth/i18n on import, which want a DOM — the same shim fight-liquidation.test.js
// installs. The PURE half above needs none of it (lost_group.js is a leaf on purpose).
const local_storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperties(globalThis, {
  window: {
    configurable: true,
    writable: true,
    value: {
      addEventListener() {},
      removeEventListener() {},
      matchMedia: () => ({ matches: false }),
      location: { origin: 'http://localhost:5173', href: 'http://localhost:5173/', search: '' },
      dispatchEvent: () => true,
      localStorage: local_storage,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    },
  },
  localStorage: { configurable: true, writable: true, value: local_storage },
  requestAnimationFrame: { configurable: true, writable: true, value: () => 0 },
  cancelAnimationFrame: { configurable: true, writable: true, value: () => {} },
})
reset_auth_mock()

const GROUP = { world_id: '0xW0', zx: 4, zy: -2, index: 3 }

describe('lost_group_of — which group a settling fight gives back', () => {
  test('a LOST open-world fight releases exactly the group it claimed', () => {
    expect(lost_group_of({ lost: true, world_group: GROUP })).toEqual(GROUP)
  })

  test('a VICTORY releases nothing (the chain door refuses a won outcome)', () => {
    expect(lost_group_of({ lost: false, world_group: GROUP })).toBeNull()
  })

  test('a dungeon room fight releases nothing — it never claimed a world group', () => {
    expect(lost_group_of({ lost: true, run_pass_id: '0xPASS', world_group: GROUP })).toBeNull()
  })

  test('an UNNAMED group is never released rather than releasing the wrong row', () => {
    expect(lost_group_of({ lost: true, world_group: null })).toBeNull()
    expect(lost_group_of({ lost: true, world_group: { world_id: '0xW0', zx: 4, zy: -2 } })).toBeNull()
    expect(lost_group_of({ lost: true, world_group: { zx: 4, zy: -2, index: 3 } })).toBeNull()
  })

  test('index 0 and zone 0,0 are REAL coordinates, never treated as missing', () => {
    const origin = { world_id: '0xW0', zx: 0, zy: 0, index: 0 }
    expect(lost_group_of({ lost: true, world_group: origin })).toEqual(origin)
  })
})

// ── The wiring: settle_chain must hand that group to the settle PTB on a defeat ──
const dungeon_actions = await import('./dungeon_actions.js')
const { settle_chain } = await import('./dungeon_settlement.js')

let settle_args = null
const settle_spy = spyOn(dungeon_actions, 'settle_and_open').mockImplementation(async (args) => {
  settle_args = args
  // Halt the chain right after the compose: this test is about WHAT settlement composes, and an executed
  // failure is the cheapest terminal path (loud, latched, no loot tail).
  throw new Error('composed — halted by the test')
})
afterAll(() => settle_spy.mockRestore())

/** A store double: settle_chain takes its store as a parameter, so no live zustand session is needed. */
const store_double = (state) => {
  let live = { _settling: false, ...state }
  return {
    getState: () => live,
    setState: (patch) => {
      live = { ...live, ...patch }
    },
  }
}

describe('settle_chain — the #609 release rides the defeat settlement', () => {
  test('a LOST world fight settles WITH its claimed group', async () => {
    settle_args = null
    const store = store_double({
      fight_id: '0xFIGHT',
      run_pass_id: null,
      world_id: '0xW0',
      character_id: '0xCHAR',
      world_group: GROUP,
    })
    await settle_chain(store, { terminal: true, lost: true })
    expect(settle_args?.fight_id).toBe('0xFIGHT')
    // THE BUG (PR #1315 review finding 11): settlement composed without a group, so every real open-world
    // defeat left its claimed group consumed forever.
    expect(settle_args?.lost_group).toEqual(GROUP)
  })

  test('a WON world fight settles with NO group to give back', async () => {
    settle_args = null
    const store = store_double({
      fight_id: '0xFIGHT',
      run_pass_id: null,
      world_id: '0xW0',
      character_id: '0xCHAR',
      world_group: GROUP,
    })
    await settle_chain(store, { terminal: true, lost: false })
    expect(settle_args?.lost_group ?? null).toBeNull()
  })
})
