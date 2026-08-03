// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2139 — THE SAME CORPSE SEAT, ON THE DUNGEON DOOR.
//
// #2136 proved the mechanism on live testnet: a co-op abandon leaves the fight ACTIVE for the teammates still in
// it, so a status-only presentability read re-adopts the abandoning seat forever, onto a board where neither D48
// exit answers (no turn to take; `actions::abandon` aborts EAlreadyDead/106). That arc was driven end to end —
// journal `Abandoned` seq 71/113, both seats freed — so the CLASS is chain-proven and these rows only have to
// prove the second door has it too. Hence unit-grade: nothing here is a new claim about the chain.
//
// The world door was `fight-liquidation.js resume_decision`. This one is `fight_liveness.js read_fight_liveness`,
// which `dungeon_run_store.resume_dungeon` gates its whole mount on (`liveness.state !== 'live'`). It answered
// from chain status ALONE, so a room fight the character had already died in read `live` and remounted.
//
// The load-bearing asymmetry these rows also pin: `fight_claim_latch.js` and `dungeon_settlement.js` call the
// SAME door while WAITING for a fight the seat died in to settle. A dead seat is their normal case, so the seat
// question is opt-in by argument — omit it and the verdict is byte-identical to before this row.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

// SYNTHETIC ids, house idiom (the chain-id gate: a test never pins a live object id).
const ME = '0xforfeited-seat' // died in the room fight — a corpse the teammates fight on around
const TEAMMATE = '0xliving-seat'
const FIGHT_ID = '0xcooproomfight'

let chain_read = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => chain_read(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { read_fight_liveness } = await import('../../src/world-shell/fight_liveness.js')
const { seat_is_dead } = await import('../../src/world-shell/fight_chain_status.js')

/** A co-op ROOM fight, chain-ACTIVE, with one dead participant and one living one. `hp` is a STRING because the
 *  gRPC json passes participants through verbatim — the exact trap a Number-blind check would fall into.
 *  @param {{ my_hp?: string, status?: number }} [over] */
const coop_room_fight = ({ my_hp = '0', status = 1 } = {}) => ({
  object: {
    version: 12,
    json: {
      id: FIGHT_ID,
      status, // fight.move ACTIVE
      turn_deadline_ms: '0',
      placement_deadline_ms: '0',
      participants: [
        { character: ME, seat: '0', hp: my_hp, max_hp: '75' },
        { character: TEAMMATE, seat: '1', hp: '31', max_hp: '45' },
      ],
      mobs: [{}],
      queue: [],
    },
  },
})

beforeEach(() => {
  set_expedition_sdk_mock(get_sdk)
  get_object.mockClear()
  chain_read = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return coop_room_fight()
  }
})

afterEach(() => reset_expedition_sdk_mock())
afterAll(restore_browser_globals)

describe('#2139 — the corpse predicate has ONE home, and the dungeon door can reach it', () => {
  test('it is imported from the zero-dep leaf, not re-spelled per reader', () => {
    // Dual-home is the class this codebase treats as its worst; the world gate re-exports the SAME binding.
    expect(typeof seat_is_dead).toBe('function')
    expect(seat_is_dead(coop_room_fight().object.json, ME)).toBe(true) // hp "0" — a string, as the wire carries it
    expect(seat_is_dead(coop_room_fight().object.json, TEAMMATE)).toBe(false)
  })

  test('the world gate still exports the identical function object (one home, two importers)', async () => {
    const { seat_is_dead: from_world_gate } = await import('../../src/world-shell/fight-liquidation.js')
    expect(from_world_gate).toBe(seat_is_dead)
  })
})

describe('#2139 — RED-FIRST: the dungeon liveness read knows whose seat it is', () => {
  test('a live co-op room fight this character DIED in is `left`, not `live`', async () => {
    // Pre-#2139 this read 'live': chain status ACTIVE, seat identity never consulted — and resume_dungeon gates
    // its entire mount on `liveness.state !== 'live'`, so the corpse board came back on every reload.
    const liveness = await read_fight_liveness(await get_sdk(), FIGHT_ID, ME)
    expect(liveness.state).toBe('left')
    expect(liveness.fight).toBeTruthy() // the record still rides along — the caller may report on it
  })

  test('the SAME fight is still `live` for the teammate who is alive in it', async () => {
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, TEAMMATE)).state).toBe('live')
  })

  test('a corpse in the PLACEMENT window is `left` too — it is the seat that is over, not the clock', async () => {
    chain_read = async () => coop_room_fight({ status: 0 })
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, ME)).state).toBe('left')
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, TEAMMATE)).state).toBe('live')
  })

  test('SETTLEMENT READERS ARE UNTOUCHED: no seat named ⇒ the pre-#2139 verdict, verbatim', async () => {
    // fight_claim_latch.js / dungeon_settlement.js wait on exactly this shape — a fight whose seat is dead and
    // whose settlement has not run. If the seat gate applied to them, the latch would stop waiting for its own
    // outcome. This row is why the question is an argument and not a new default.
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID)).state).toBe('live')
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, null)).state).toBe('live')
  })

  test('a terminal fight is still `settled`, and an absent one still `absent`, whoever is asking', async () => {
    chain_read = async () => coop_room_fight({ status: 3 })
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, ME)).state).toBe('settled')
    chain_read = async () => ({ object: null }) // the node answering "no such object" — a destroyed Fight
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, ME)).state).toBe('absent')
  })

  test('a torn read still THROWS — a death is never inferred from an incomplete record', async () => {
    chain_read = async () => ({ object: { version: 12, json: { id: FIGHT_ID, participants: [] } } })
    await expect(read_fight_liveness(await get_sdk(), FIGHT_ID, ME)).rejects.toThrow(/torn read/)
  })

  test('an absent seat is not a death: a partial participants read keeps the live verdict', async () => {
    chain_read = async () => ({
      object: { version: 12, json: { id: FIGHT_ID, status: 1, participants: [], mobs: [], queue: [] } },
    })
    expect((await read_fight_liveness(await get_sdk(), FIGHT_ID, ME)).state).toBe('live')
  })
})

describe('#2139 — the resume door asks the seat question; the settlement doors do not', () => {
  test('resume_dungeon names the character, and the two settlement readers deliberately do not', async () => {
    // Source-shape row (the store action is a closure over module state; the world_spawns.test.js idiom). It pins
    // the ASYMMETRY, which is the whole design: one caller opted in, and the others must not drift into it.
    const store = await Bun.file(new URL('../../src/world-shell/dungeon_run_store.js', import.meta.url)).text()
    expect(store).toContain('read_fight_liveness(sdk, pass.fight, character_id)')

    const latch = await Bun.file(new URL('../../src/world-shell/fight_claim_latch.js', import.meta.url)).text()
    expect(latch).toContain('read_fight_liveness_fn(await get_sdk_fn(), fight_id)') // no seat — it AWAITS the death
    const settlement = await Bun.file(new URL('../../src/world-shell/dungeon_settlement.js', import.meta.url)).text()
    expect(settlement).toContain('read_fight_liveness(await get_sdk(), id)') // likewise
  })
})
