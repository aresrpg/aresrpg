// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D110 PLACEMENT FORCE-START liquidation proof (board #49 sibling of the turn-crank liquidation), on the S-46
// ENGINE doors: drives `maybe_force_start` with a synthetic EXPIRED placement deadline and asserts the
// permissionless `turns::force_start` seam fires EXACTLY ONCE (single-flight across re-probes), stays SILENT,
// no-ops before the deadline, and LATCHES an executed on-chain race abort (S-57 tx-retry burn law — same
// deadline never re-fired; a FRESH window re-arms by key). `./dungeon_actions` (the whole SDK/auth graph) is
// mocked to a capturing stub so the test is hermetic. Jitter pinned to 0 (Math.random→0) for determinism.

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'

/** @type {{ id: string, silent: boolean }[]} */
let force_calls = []
let force_impl = /** @type {(id: string, silent: boolean) => Promise<any>} */ (
  (id, silent) => {
    force_calls.push({ id, silent })
    return Promise.resolve({})
  }
)
let place_impl = /** @type {() => Promise<any>} */ (() => Promise.resolve({}))

const global_keys = ['window', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame']
const global_descriptors = new Map(global_keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
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
// SIZE-LAW SPLIT (2026-07-20): create_world_fight/mint_rolled/burn_result now live in dungeon_engage_actions.js
// (zero cycle-embedded consumer) — spied on their own defining module; everything else this suite stubs stayed
// in dungeon_actions.js (this file's own SUT, fight-liquidation.js, is itself a cycle-embedded consumer of it).
const dungeon_actions = await import('./dungeon_actions')
const dungeon_engage_actions = await import('./dungeon_engage_actions')
const inert_action = async () => ({})
const action_spies = [
  spyOn(dungeon_actions, 'as_one_toast').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'create_world_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'join_world_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'activate_run').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'next_room_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'join_room_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'abandon_run').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'place').mockImplementation(() => place_impl()),
  spyOn(dungeon_actions, 'force_start').mockImplementation((id, silent) => force_impl(id, silent)),
  spyOn(dungeon_actions, 'crank').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'commit_turn_batch').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'abandon_fight').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'settle_and_open').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'settle_run_and_open').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'open_outcome').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'mint_rolled').mockImplementation(inert_action),
  spyOn(dungeon_engage_actions, 'burn_result').mockImplementation(inert_action),
  spyOn(dungeon_actions, 'mint_all_and_burn').mockImplementation(inert_action),
]

const { maybe_force_start, reset_liquidation } = await import('./fight-liquidation.js')
const { use_dungeon } = await import('./dungeon_store.js')
const { context } = await import('../game/store.js')

const STATUS_PLACEMENT = 5
const STATUS_ACTIVE = 1

/** A dungeon read whose placement window closed `ago` ms ago (default: expired 1s ago). */
const expired_placement = (ago = 1000, over = {}) => ({
  id: '0xDGN',
  status: STATUS_PLACEMENT,
  placement_deadline_ms: Date.now() - ago,
  ...over,
})

/** dungeon_store `get` double: a live store snapshot mirroring the read (so the fire-time re-check passes). */
const make_get = (dungeon) => () => ({ dungeon, busy: false, refresh: () => Promise.resolve() })

/** Let the jitter setTimeout(…, 0) + the async tx body drain. */
const flush = () => new Promise((r) => setTimeout(r, 5))

async function until(pred, timeout_ms = 2000) {
  const started_ms = Date.now()
  while (!pred()) {
    if (Date.now() - started_ms > timeout_ms) throw new Error('fight state did not converge')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let random_spy
const real_random = Math.random
beforeEach(() => {
  force_calls = []
  force_impl = (id, silent) => {
    force_calls.push({ id, silent })
    return Promise.resolve({})
  }
  place_impl = () => Promise.resolve({})
  reset_liquidation()
  random_spy = () => 0 // pin jitter to 0
  globalThis.Math.random = random_spy
})
afterEach(() => {
  reset_liquidation()
  Math.random = real_random
})

afterAll(() => {
  for (const spy of action_spies) spy.mockRestore()
  for (const key of global_keys) {
    const descriptor = global_descriptors.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

describe('D110 placement force-start liquidation', () => {
  it('fires begin_active_if_expired ONCE, silently, on an expired placement deadline', async () => {
    const d = expired_placement()
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(1)
    expect(force_calls[0]).toEqual({ id: '0xDGN', silent: true })
  })

  it('SINGLE-FLIGHT: re-probing the SAME window across polls never double-fires', async () => {
    const d = expired_placement()
    const get = make_get(d)
    maybe_force_start(d, get) // poll 1
    maybe_force_start(d, get) // poll 2 (same window, tx still confirming)
    maybe_force_start(d, get) // poll 3
    await flush()
    expect(force_calls.length).toBe(1)
  })

  it('does NOT fire before the deadline (window still open)', async () => {
    const d = expired_placement(-30_000) // deadline 30s in the FUTURE
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(0)
  })

  it('does NOT fire outside PLACEMENT (an ACTIVE dungeon)', async () => {
    const d = { id: '0xDGN', status: STATUS_ACTIVE, placement_deadline_ms: Date.now() - 1000 }
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(0)
  })

  it('does NOT fire when placement_deadline_ms is unset (0)', async () => {
    const d = { id: '0xDGN', status: STATUS_PLACEMENT, placement_deadline_ms: 0 }
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(0)
  })

  it('a FRESH window (new deadline) is eligible again after the prior one fired', async () => {
    const d1 = expired_placement()
    maybe_force_start(d1, make_get(d1))
    await flush()
    expect(force_calls.length).toBe(1)
    // a later room opens a NEW placement window (distinct deadline) — the single-flight key differs → eligible.
    const d2 = expired_placement(1000, { placement_deadline_ms: Date.now() - 500 })
    maybe_force_start(d2, make_get(d2))
    await flush()
    expect(force_calls.length).toBe(2)
  })

  it('LATCHES an executed on-chain race abort (losing racer): same window never re-fires; a fresh one does', async () => {
    force_impl = () => Promise.reject(new Error('MoveAbort: ENotPlacement — already started'))
    const d = expired_placement()
    // must not reject: the probe catches the executed abort (debug-only, silent) and LATCHES the deadline.
    expect(() => maybe_force_start(d, make_get(d))).not.toThrow()
    await flush()
    force_impl = (id, silent) => {
      force_calls.push({ id, silent })
      return Promise.resolve({})
    }
    // S-57 latch law: the SAME window (same deadline) is consumed — re-probing never burns gas again.
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(0)
    // a NEW window (distinct deadline) re-arms by key and fires.
    const d2 = expired_placement(1000, { placement_deadline_ms: Date.now() - 400 })
    maybe_force_start(d2, make_get(d2))
    await flush()
    expect(force_calls.length).toBe(1)
  })

  it('re-arms on a PRE-FLIGHT failure (no digest — network/sign): the same window retries next poll', async () => {
    force_impl = () => Promise.reject(new Error('fetch failed: network unreachable'))
    const d = expired_placement()
    maybe_force_start(d, make_get(d))
    await flush()
    force_impl = (id, silent) => {
      force_calls.push({ id, silent })
      return Promise.resolve({})
    }
    maybe_force_start(d, make_get(d)) // same window — pre-flight failure re-armed it
    await flush()
    expect(force_calls.length).toBe(1)
  })

  it('skips at fire-time if the store already left PLACEMENT during the jitter (no wasted gas)', async () => {
    const d = expired_placement()
    // the read that scheduled the fire is expired-placement, but by fire time the store advanced to ACTIVE.
    const advanced = { id: '0xDGN', status: STATUS_ACTIVE, placement_deadline_ms: d.placement_deadline_ms }
    maybe_force_start(d, make_get(advanced))
    await flush()
    expect(force_calls.length).toBe(0)
  })
})

// ── D169 regression (qa: RESUMED fight frozen 157s past the 90s deadline) — a busy-at-fire-time SKIP must
//    NOT consume the per-deadline dedup: the next poll's probe re-arms and the pass actually fires. ──
describe('D169 · skip re-arms the dedup (frozen-resume class)', () => {
  it('busy skip → next probe fires begin_active_if_expired', async () => {
    reset_liquidation()
    force_calls = []
    const dungeon = expired_placement()
    let busy = true // resume_dungeon holds busy=true through its own first refresh — THE freeze window
    const get = () => ({ dungeon, busy, refresh: () => Promise.resolve() })
    maybe_force_start(dungeon, get) // arms; fire-time hits the busy guard and SKIPS
    await new Promise((r) => setTimeout(r, 5))
    expect(force_calls.length).toBe(0) // skipped, correctly
    busy = false // resume finished
    maybe_force_start(dungeon, get) // the NEXT poll — pre-fix this early-returned forever (dedup consumed)
    await new Promise((r) => setTimeout(r, 5))
    expect(force_calls.length).toBe(1) // D169: the skip re-armed; the pass fires
  })
})

// ── M3 TX TRANSPARENCY (every transaction must be visible, M3 wiring row (a)): every
//    background-fired fight tx announces itself through the ONE toast home — the liquidation crank and the
//    placement force-start each push one honest info toast when (and only when) their tx actually fires. ──
describe('M3 · tx transparency toasts on the background janitors', () => {
  it('a fired force_start pushes the auto_force_start_fired event toast', async () => {
    const { event_toast_store } = await import('../game/core/toast.js')
    const { default: i18n } = await import('../i18n')
    // freshness by TOAST ID (the stack caps at 3 — length slicing lies once earlier fires filled the cap)
    const floor = Math.max(0, ...event_toast_store.get().map((t) => t.id))
    const d = expired_placement()
    maybe_force_start(d, make_get(d))
    await until(() => force_calls.length === 1)
    const fresh = event_toast_store.get().filter((t) => t.id > floor)
    expect(fresh.some((t) => t.title === i18n.t('dungeons.auto_force_start_fired'))).toBe(true)
  })

  it('a fired liquidation crank fires SILENTLY — no player-facing toast (owner ruling: the crank is machinery)', async () => {
    const { maybe_liquidate } = await import('./fight-liquidation.js')
    const { event_toast_store } = await import('../game/core/toast.js')
    const before_calls = dungeon_actions.crank.mock?.calls?.length ?? 0
    const floor = Math.max(0, ...event_toast_store.get().map((t) => t.id))
    const d = { id: '0xDGN', status: STATUS_ACTIVE, turn_deadline_ms: Date.now() - 1000 }
    maybe_liquidate(d, () => ({ dungeon: d, busy: false, refresh: () => Promise.resolve() }))
    await until(() => (dungeon_actions.crank.mock?.calls?.length ?? 0) > before_calls)
    // the crank STILL fires (machinery intact) but pushes ZERO toasts — the "advancing the fight" news is gone.
    expect(event_toast_store.get().filter((t) => t.id > floor)).toEqual([])
  })

  it('a NON-fire probe (deadline not passed) pushes NO toast', async () => {
    const { event_toast_store } = await import('../game/core/toast.js')
    const floor = Math.max(0, ...event_toast_store.get().map((t) => t.id))
    const d = expired_placement(-60_000) // still 60s of placement left
    maybe_force_start(d, make_get(d))
    await flush()
    expect(force_calls.length).toBe(0)
    expect(event_toast_store.get().filter((t) => t.id > floor).length).toBe(0)
  })
})
