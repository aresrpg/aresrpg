// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2178 ② — the DROPPED INVALIDATION behind "sometimes forever-stale until a page refresh".
//
// `load_roster()` is the inventory's ONLY reconciliation door: there is no poll, no subscription — every
// gameplay tx calls it by hand. Its single-flight guard used to DROP a request that arrived while a load was
// in flight, on the stated theory that "the in-flight load dispatches the up-to-date roster when it lands".
// That theory is false by construction: the in-flight pass's chain reads STARTED BEFORE the dropped caller's
// write landed, so its snapshot cannot contain it. The repaint was then lost entirely — not delayed — and
// nothing ever asked again. The window is wide: the bag leg (`get_owned_items`) walks every personal kiosk
// under a 25s bound.
//
// The guard's PURPOSE (never N concurrent kiosk walks) is preserved: a burst coalesces into exactly ONE
// follow-up pass, whose reads start after every request in that burst.

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const fake_sdk = { grpc_client: {}, get_creation_state: async () => null }

const rpc_client = await import('../../src/rpc/client')
const read_staking = await import('../../src/chain/read_staking.js')
const auto_merge = await import('../../src/world-shell/auto_merge_stacks.js')
const dungeon_session = await import('../../src/world-shell/dungeon_session.js')
const { context } = await import('../../src/game/core/game.js')
const { default: sui_session } = await import('../../src/game/core/modules/sui_session.js')
const { load_roster } = await import('../../src/roster/load_roster.js')

// Own door onto the ambient engine handle, folded through the ENGINE'S OWN sui_session reducer. bun's
// `mock.module` is process-global AND irreversible, so in a whole-suite run that handle can arrive stubbed by
// a component suite that replaced `game/store.js` — and a stubbed handle turns every `load_roster` dispatch
// into a TypeError, measuring another file's mock ordering instead of this one's read count. Restored after.
const engine_reduce = sui_session().reduce
const empty_state = () => ({
  sui: {
    items: [],
    characters: [],
    settled_item_floor: {},
    minted_character_floor: {},
    pending_uses: {},
    xp_floor: {},
    deleted_ids: {},
    loaded: false,
    load_error: null,
  },
})
let engine_state = empty_state()
const ambient = { dispatch: context.dispatch, get_state: context.get_state }
context.dispatch = (type, payload) => {
  engine_state = engine_reduce(engine_state, { type, payload }) ?? engine_state
}
context.get_state = () => engine_state
afterAll(() => {
  context.dispatch = ambient.dispatch
  context.get_state = ambient.get_state
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let reads = 0
/** Releases the FIRST /v1 identity read; every later one resolves immediately. */
let release_first_read = () => {}
let spies = []

beforeEach(() => {
  reads = 0
  engine_state = empty_state()
  reset_auth_mock({ address: '0xowner', wallet_name: 'zklogin' })
  set_expedition_sdk_mock(async () => fake_sdk)
  spies = [
    spyOn(rpc_client, 'get_characters').mockImplementation(() => {
      reads += 1
      if (reads > 1) return Promise.resolve([])
      return new Promise((resolve) => {
        release_first_read = () => resolve([])
      })
    }),
    spyOn(read_staking, 'get_owned_items').mockResolvedValue([]),
    spyOn(read_staking, 'get_owned_items_from_kiosks').mockResolvedValue([]),
    spyOn(auto_merge, 'sweep_duplicate_stacks').mockResolvedValue(undefined),
    spyOn(dungeon_session, 'read_dungeon_session').mockReturnValue({
      in_session: false,
      character_id: null,
      session_address: null,
    }),
  ]
})

afterEach(async () => {
  for (const test_spy of [...spies].reverse()) test_spy.mockRestore()
  spies = []
  reset_expedition_sdk_mock()
  reset_auth_mock()
  await settle()
})

describe('#2178 ② — a repaint request is never dropped', () => {
  test('a request arriving mid-load is served by a follow-up pass, not discarded', async () => {
    const in_flight = load_roster()
    await settle() // the first pass is parked on its /v1 identity read

    const during = load_roster() // a tx just landed — its snapshot CANNOT be in the read already running
    release_first_read()
    await Promise.all([in_flight, during])
    await settle()

    expect(reads).toBe(2)
  })

  test('a burst coalesces into ONE follow-up pass — never one chain walk per caller', async () => {
    const in_flight = load_roster()
    await settle()

    const burst = [load_roster(), load_roster(), load_roster()]
    release_first_read()
    await Promise.all([in_flight, ...burst])
    await settle()

    expect(reads).toBe(2)
  })

  test('with no load in flight each call runs its own pass', async () => {
    const first = load_roster()
    release_first_read()
    await first
    await load_roster()

    expect(reads).toBe(2)
  })
})
