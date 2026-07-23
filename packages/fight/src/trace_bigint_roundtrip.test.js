// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BIGINT ROUND-TRIP (issue #209 P1, RED-FIRST) — live crash: `Uncaught TypeError: Do not know how to
// serialize a BigInt` at JSON.stringify(trace) the instant a captured trace held a 'snapshot' input.
//
// PROVENANCE: decode_fight() (packages/sdk/src/fight_read.js:53-108) types several chain u64 fields as
// native BigInt — Number() would silently lose precision above 2^53 (the file's own comment: "a real 16×8
// board lost 26/125 mask cells" testing this exact tradeoff for shape_mask): spawn_id, world_seed, turn_ms,
// placement_ms, turn_deadline_ms, last_action_ms, placement_deadline_ms, group_xp, and shape_mask (a BigInt[]
// — one u64 bitset word per element). This decoded object reaches the store VERBATIM as a 'snapshot' input's
// `msg.fight` — packages/frontend/src/world-shell/dungeon_fight_sync.js `sync_dungeon_fight` (`const fight =
// decode_fight(read.json)` then `fight_store.getState().input({ type: 'snapshot', fight, ... })`) and
// dungeon_run_store.js:869 both call decode_fight directly, immediately before dispatch. The tap captures
// that message verbatim (trace_tap.js), so a captured trace's `inputs[].msg.fight` carries the SAME BigInt
// fields the live client just decoded — the fixture below mirrors that shape field-for-field, not a guess.

import { describe, test, expect } from 'bun:test'

import { create_fight_store } from './store.js'
import { stringify_trace, parse_trace } from './trace_recorder.js'

const FIGHT = '0xtrace_bigint_fight'
const ME = '0xchar_bigint'
const OWNER = '0xowner_bigint'
const T0 = 1_000_000

// The REAL decode_fight() output shape (fight_read.js:53-108) — BigInt fields carry genuine >2^53 magnitudes
// (a Number would silently truncate them), exactly the class of value a live chain read produces.
const real_decoded_fight = () => ({
  id: FIGHT,
  world: '0xworld_bigint_fixture',
  spawn_id: 987_654_321_098_765_432n, // to_bigint(json.spawn_id)
  world_seed: 12_345_678_901_234_567_890n, // to_bigint(json.world_seed)
  anchor_x: 5,
  anchor_z: 6,
  public_fight: false,
  party_id: null,
  aged_bp: 0,
  turn_ms: 90_000n, // to_bigint(json.turn_ms)
  placement_ms: 60_000n, // to_bigint(json.placement_ms)
  team_bound: 0,
  status: 1, // ACTIVE
  status_label: 'active',
  participants: [
    {
      owner: OWNER,
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  mobs: [{ template: '0xmob_t', level: 3, hp: 40, max_hp: 40, cell: 45, ap: 6, mp: 3 }],
  participant_count: 1,
  mob_count: 1,
  width: 20,
  height: 19,
  // shape_mask: u64 BITSET WORDS — a full word (all 64 bits set, > Number.MAX_SAFE_INTEGER) + an empty one,
  // the documented high-bit-loss case (fight_read.js:29-30).
  shape_mask: [18_446_744_073_709_551_615n, 0n],
  obstacles: [],
  holes: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 1_700_000_090_000n, // to_bigint(json.turn_deadline_ms)
  last_action_ms: 1_700_000_000_000n, // to_bigint(json.last_action_ms)
  placement_deadline_ms: 1_700_000_060_000n, // to_bigint(json.placement_deadline_ms)
  group_template: '0xmob_t',
  group_xp: 500_000_000_000n, // to_bigint(group.xp)
  group_base_ap: 6,
  group_base_mp: 3,
})

/** Drive a store through init -> a REAL-SHAPED snapshot, exactly as sync_dungeon_fight does live. */
const drive_fight = () => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: 20 } } },
      T0
    )
  store.getState().input({ type: 'snapshot', fight: real_decoded_fight(), fight_id: FIGHT, version: 1 }, T0 + 100)
  return store
}

describe('the reported crash, reproduced (RED)', () => {
  test('a bare JSON.stringify on a trace holding this snapshot throws — the exact live symptom', () => {
    const store = drive_fight()
    const trace = store.trace_tap.dump_current_trace('bigint-red-test', T0 + 5_000, FIGHT)
    expect(trace).not.toBe(null)
    expect(() => JSON.stringify(trace)).toThrow(TypeError)
    expect(() => JSON.stringify(trace)).toThrow(/BigInt/)
  })
})

describe('stringify_trace / parse_trace — the BigInt round-trip fix (GREEN)', () => {
  test('stringify_trace succeeds, produces valid JSON, and parse_trace revives EXACT BigInt values', () => {
    const original = drive_fight()
    const trace = original.trace_tap.dump_current_trace('bigint-green-test', T0 + 5_000, FIGHT)

    const text = stringify_trace(trace)
    expect(() => JSON.parse(text)).not.toThrow() // valid JSON on the wire — no raw BigInt leaked through

    const revived = parse_trace(text)
    const snapshot_msg = revived.inputs.find((i) => i.msg.type === 'snapshot').msg
    expect(typeof snapshot_msg.fight.world_seed).toBe('bigint')
    expect(snapshot_msg.fight.world_seed).toBe(12_345_678_901_234_567_890n) // exact — Number() would truncate this
    expect(snapshot_msg.fight.spawn_id).toBe(987_654_321_098_765_432n)
    expect(snapshot_msg.fight.turn_ms).toBe(90_000n)
    expect(snapshot_msg.fight.group_xp).toBe(500_000_000_000n)
    // shape_mask: a BigInt ARRAY — every element revives, not just the object-shaped fields.
    expect(snapshot_msg.fight.shape_mask).toEqual([18_446_744_073_709_551_615n, 0n])

    // REPLAY: folding the revived inputs through a fresh store reproduces the original's projection —
    // the round-trip didn't just avoid throwing, it preserved the fact the field exists for.
    const replayed = create_fight_store()
    for (const { msg, at } of revived.inputs) replayed.getState().input(msg, at)
    expect(replayed.getState().view.world_seed).toBe(original.getState().view.world_seed)
    expect(replayed.getState().view.world_seed).toBe(12_345_678_901_234_567_890n)
  })

  test('a trace with no BigInt at all still round-trips (the common case is untouched)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: 'plain-fight' }, T0)
    const trace = store.trace_tap.dump_current_trace('v', T0, 'plain-fight')
    const revived = parse_trace(stringify_trace(trace))
    expect(revived).toEqual(trace)
  })
})
