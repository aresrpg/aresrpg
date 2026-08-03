// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2136 — A SEAT THAT ALREADY DIED IS NOT A SEAT TO RESUME.
//
// THE DISCRIMINATOR, FIRST. The 2026-08-04 co-op sweep reported "the in-fight FORFEIT composes NO transaction in
// a co-op fight". Driven against the living repro (`0x320657f1…c337a177`, testnet, both QA seats), the chain says
// otherwise: the forfeit DID compose and land — journal seq 71 `Abandoned`, digest
// `4imtakM71wwc3zEDSVKWAaScXucnGoLY3t3kZqT88TMZ`, `actions::abandon`, status success, 2026-08-03T18:46:45.520Z —
// and the participant row for `0x69dd2291…` reads `hp: "0"` on chain to this day. Neither variable of the 2×2
// (co-op-vs-solo, latched-vs-unlatched) kills the composition; nothing does. What differs is what happens AFTER:
//
//   SOLO  abandon ⇒ the side wipes ⇒ the fight goes terminal, settles, and is DESTROYED. No candidate survives.
//   CO-OP abandon ⇒ the fight lives on for the teammates still in it, and `/v1/fights?character=` keeps listing
//                   it, because a dead participant is still a participant.
//
// And THAT is where the seat was actually lost: the boot resume gate decided presentability from chain status +
// deadlines ALONE (fight-liquidation.js `resume_decision`), so every subsequent boot re-adopted the corpse seat,
// bought a `turns::crank` to do it, and dropped the player onto a board where BOTH D48 exits abort — no turn to
// play, and `actions::abandon` refuses a second death (engine actions.move `EAlreadyDead: u64 = 106`). "Forfeit
// did nothing" is what a permanent, self-restoring wedge looks like from the player's chair.
//
// These rows are RED against the landed gate. Harness idiom mirrors world_fight_resume_auto.test.js — whose D48
// reachable-state invariant they EXTEND with the state a corpse seat may be observed in: roaming, and only that.
// /v1 through the fetch mock, the chain read through the expedition SDK mock, chain WRITES through injected
// doors (nothing signs in a unit test).

import fs from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

// SYNTHETIC ids, house idiom (chain-id gate: a test never pins a live object id — the living repro is named in
// the header by its truncated prefix, which is where a reader goes to re-read it).
const OWNER = '0xowner'
const ME = '0xforfeited-seat' // the living repro's canaryalice — abandoned, hp 0
const TEAMMATE = '0xliving-seat' // its qayajin — still alive in the same fight
const FIGHT_ID = '0xwedgedcoopfight'
const WORLD_ID = '0xworld'
const HOUR_MS = 3_600_000

let chain_read = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => chain_read(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../../src/auth')
const { _reset_rpc_client_for_test } = await import('../../src/rpc/client')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { resume_world_fight } = await import('../../src/world-shell/world_fight.js')
const { resume_decision, seat_is_dead } = await import('../../src/world-shell/fight-liquidation.js')
const { _reset_log_for_test, get_log_buffer } = await import('../../src/core/log.js')
const { dismiss_event_toast, event_toast_store } = await import('../../src/game/core/toast.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch
const real_console_error = console.error
let console_error = mock(() => {})

/**
 * THE LIVING REPRO, in the shape `decode_fight` hands the gate: ACTIVE, its turn deadline long past, one dead
 * participant and one living one. `hp` is a STRING because the gRPC json passes participants through verbatim —
 * the exact trap a Number-blind check would fall into. Field values copied from the chain read of the fight.
 * @param {{ my_hp?: string, turn_deadline_ms?: number, status?: number }} [over]
 */
const wedged_coop_fight = ({ my_hp = '0', turn_deadline_ms = Date.now() - HOUR_MS, status = 1 } = {}) => ({
  object: {
    version: 964574426,
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status, // fight.move ACTIVE
      turn_deadline_ms: String(turn_deadline_ms),
      placement_deadline_ms: '0',
      participants: [
        { character: ME, seat: '0', hp: my_hp, max_hp: '75', cell: '45', team: 0 },
        { character: TEAMMATE, seat: '1', hp: '20', max_hp: '45', cell: '5', team: 0 },
      ],
      mobs: [{}, {}],
      queue: [
        { idx: '0', is_mob: false },
        { idx: '0', is_mob: true },
        { idx: '1', is_mob: false },
        { idx: '1', is_mob: true },
      ],
    },
  },
})

/** /v1 still lists the fight for a DEAD participant — the projection that keeps handing the corpse back. */
const serve_live_seat = () => {
  globalThis.fetch = mock(async (input) => {
    const body = new URL(String(input)).pathname.endsWith('/fights')
      ? { fights: [{ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' }] }
      : { characters: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

const settle_tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const toasts = () => event_toast_store.get()
const trace_rows = () => /** @type {any[]} */ (globalThis.window?.__ARES_FIGHT_TRACE ?? [])
const traced = (event) => trace_rows().filter((row) => row.event === event)
const logs = (needle) => get_log_buffer().filter((row) => row.ns === 'world-fight' && row.message.includes(needle))

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
  _reset_log_for_test()
  serve_live_seat()
  for (const toast of toasts()) dismiss_event_toast(toast.id)
  console_error = mock(() => {})
  console.error = console_error
  const target = /** @type {any} */ (globalThis.window)
  target.__ARES_FIGHT_TRACE_ENABLED = true
  target.__ARES_FIGHT_TRACE = []
  chain_read = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return wedged_coop_fight()
  }
})

afterEach(() => {
  console.error = real_console_error
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  _reset_log_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('#2136 — the corpse-seat predicate (pure)', () => {
  const decoded = () => wedged_coop_fight().object.json

  test('positive control: it convicts the chain-shaped corpse and acquits the living seat beside it', () => {
    expect(seat_is_dead(decoded(), ME)).toBe(true) // hp "0" — a string, exactly as the wire carries it
    expect(seat_is_dead(decoded(), TEAMMATE)).toBe(false) // hp "20"
  })

  test('an ABSENT seat is never a death — a torn read may not lock a live player out of their own fight', () => {
    expect(seat_is_dead(decoded(), '0xsomeone-not-in-this-fight')).toBe(false)
    expect(seat_is_dead({ participants: [] }, ME)).toBe(false)
    expect(seat_is_dead(null, ME)).toBe(false)
    expect(seat_is_dead(decoded(), null)).toBe(false) // no seat named ⇒ the pre-#2136 status-only verdict
  })
})

describe('#2136 — RED-FIRST: presentability knows whose seat it is', () => {
  const now = Date.now()

  test('the wedged co-op fight this character DIED in is `left`, not `crank`', () => {
    // Pre-#2136 this read 'crank': status ACTIVE + an expired turn deadline, seat identity never consulted. That
    // verdict bought a janitor transaction and then mounted a board with no legal move and no second forfeit.
    expect(resume_decision(wedged_coop_fight().object.json, now, ME)).toBe('left')
  })

  test('the SAME fight is still `crank` for the teammate who is alive in it — the heal is untouched', () => {
    expect(resume_decision(wedged_coop_fight().object.json, now, TEAMMATE)).toBe('crank')
  })

  test('a corpse inside its deadline is `left` too — it is the seat that is over, not the clock', () => {
    const fresh = wedged_coop_fight({ turn_deadline_ms: now + HOUR_MS }).object.json
    expect(resume_decision(fresh, now, ME)).toBe('left')
    expect(resume_decision(fresh, now, TEAMMATE)).toBe('enter')
  })

  test('a corpse in a PLACEMENT window is `left`; a terminal fight stays `skip` (the outcome flow owns it)', () => {
    const placing = wedged_coop_fight({ status: 0 }).object.json
    expect(resume_decision(placing, now, ME)).toBe('left')
    expect(resume_decision({ ...wedged_coop_fight().object.json, status: 3 }, now, ME)).toBe('skip')
  })

  test('a torn read (no status) is still `skip`, whoever is asking — a death is never inferred from nothing', () => {
    expect(resume_decision({ ...wedged_coop_fight().object.json, status: null }, now, ME)).toBe('skip')
  })
})

describe('#2136 — RED-FIRST: the boot resume leaves a forfeited co-op seat alone', () => {
  test('no crank, no mount, no strand cry — and the skip says why', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))

    await resume_world_fight(ME, { crank_door })
    await settle_tick()

    // THE MONEY HALF: the corpse gate runs BEFORE the door, so a fight this character has left stops buying one
    // permissionless transaction per boot (the #1751 burn shape, re-armed by a forfeit).
    expect(crank_door).not.toHaveBeenCalled()
    expect(traced('fight_resume_auto')).toHaveLength(0) // nothing to consent to: nothing is composed
    // THE WEDGE HALF: the board that had no exits is never mounted again.
    expect(use_dungeon.getState().fight_id).toBeNull()
    // Not a strand (#2125/#932): the player LEFT this fight on purpose. Quiet, traced, never a red console line.
    expect(console_error).not.toHaveBeenCalled()
    expect(toasts()).toHaveLength(0)
    expect(traced('fight_resume_seat_dead')).toHaveLength(1)
    expect(traced('fight_resume_seat_dead')[0]).toMatchObject({ fight_id: FIGHT_ID, character_id: ME })
    expect(logs('already left the fight')).toHaveLength(1)
  })

  test('non-regression: the LIVING teammate still cranks the same wedged fight and mounts it', async () => {
    const crank_door = mock(async () => {
      chain_read = async () => wedged_coop_fight({ turn_deadline_ms: Date.now() + HOUR_MS })
      return { digest: '0xcrank' }
    })

    await resume_world_fight(TEAMMATE, { crank_door })
    await settle_tick()

    expect(crank_door).toHaveBeenCalledTimes(1)
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
  })

  test('a seat killed BY the crank it paid for is left behind too, not mounted onto a corpse board', async () => {
    // `turns::crank` resolves the mob turns its forfeit unblocked, and one of them can kill the resuming seat.
    // The post-door re-read is the same question, so it gets the same answer — never "the door worked, mount it".
    chain_read = async () => wedged_coop_fight({ my_hp: '12' })
    const crank_door = mock(async () => {
      chain_read = async () => wedged_coop_fight({ my_hp: '0', turn_deadline_ms: Date.now() + HOUR_MS })
      return { digest: '0xcrank' }
    })

    await resume_world_fight(ME, { crank_door })
    await settle_tick()

    expect(crank_door).toHaveBeenCalledTimes(1) // the seat was alive when it was bought — that spend is legitimate
    expect(use_dungeon.getState().fight_id).toBeNull()
    expect(traced('fight_resume_seat_dead')).toHaveLength(1)
  })
})

// ── D48 · THE REACHABLE-STATE INVARIANT, EXTENDED ────────────────────────────────────────────────────────────
// world_fight_resume_auto.test.js pins the states reachable from a HELD seat: {mounted fight, auto-resume in
// flight}. #2136 adds the state a seat reaches through the ruling's OTHER exit. Death and surrender are exits, so
// the state after one is the overworld — permanently, across candidacies. The one state that must be
// unreachable is the mounted board a dead seat cannot act on and cannot leave.
describe('D48 — death is an exit, so a dead seat is only ever observed roaming', () => {
  test('two candidacies from a corpse seat observe exactly {roaming}', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))
    const observed = new Set()

    for (let candidacy = 0; candidacy < 2; candidacy += 1) {
      await resume_world_fight(ME, { crank_door })
      await settle_tick()
      observed.add(use_dungeon.getState().fight_id == null ? 'roaming' : 'mounted')
    }

    expect(observed).toEqual(new Set(['roaming']))
    expect(crank_door).not.toHaveBeenCalled() // and the wedge costs nothing to stay out of
    expect(traced('fight_resume_seat_dead')).toHaveLength(2)
  })

  test('the premise is mechanical: the engine refuses a second death, so re-mounting really has no exit', () => {
    // The reason a corpse board is a WEDGE and not merely an odd view. If this ever stops being true, the gate
    // above becomes a policy choice rather than a necessity, and this row is where that shows up.
    const actions = fs.readFileSync(new URL('../../../move/engine/sources/actions.move', import.meta.url), 'utf8')
    expect(actions).toContain('const EAlreadyDead: u64 = 106')
    expect(actions).toMatch(/abandon: the seat is already dead/)
    // positive control: the scan reads the real module, not an empty string that would pass anything
    expect(actions).toContain('entry fun abandon(')
  })
})
