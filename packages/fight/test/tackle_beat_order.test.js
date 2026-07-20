// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D3 BEAT ORDER — a tackled player plays the hit animation just before moving —
// the Tackled chain event (fight_events.move: {fight, runner_is_mob, runner_idx, ap_lost, mp_lost, num, den})
// must present as the runner's HIT/forfeit beat, landing IMMEDIATELY BEFORE the move (or standing alone as
// the MP-forfeit when the denial ends the walking) — never after it, never merged into it. The chain emits
// Tackled at the denial and any later successful retry emits its own Moved, so the producer appending in
// EVENT ORDER on the runner's writer clock gives the law by construction; these rows pin it against drift
// (today the producer silently DROPS Tackled — the bite presents as nothing).
// The FOLD half: the event carries the DELTAS the chain stripped — the committed fold adopts them onto the
// runner's overlay pools (post-view entries fold once, keyed version:event_idx — idempotent by identity).

import { describe, expect, test } from 'bun:test'

import { produce_receipt_render_turns } from '../src/fight_render_events.js'
import { apply_action, fold_log } from '../src/inputs.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

const raw = (name, parsedJson) => ({ type: `0x0::fight_events::${name}`, parsedJson: { fight: FIGHT, ...parsedJson } })

// u64 fields arrive as STRINGS off Sui JSON (the SDK decoder only coerces its known-numeric set — Tackled's
// fields are not in it), so the fixtures carry strings on purpose: the consumers own the coercion.
const TACKLED = raw('Tackled', {
  runner_is_mob: false,
  runner_idx: '0',
  ap_lost: '3',
  mp_lost: '2',
  num: '6',
  den: '12',
})

describe('produce_receipt_render_turns — the Tackled beat and its order', () => {
  const resolve_fighter_id = ({ is_mob, idx, character }) => character ?? (is_mob ? `mob-${idx}` : CHAR)

  test('DENIAL THEN RETRY-ESCAPE: the tackled beat lands strictly BEFORE the move beat, same runner turn', () => {
    const { turns } = produce_receipt_render_turns(
      [
        raw('TurnStarted', { is_mob: false, idx: '0', deadline_ms: '90000' }),
        TACKLED,
        raw('Moved', { character: CHAR, to_cell: '44' }),
      ],
      { fight_id: FIGHT, grid_width: 20, resolve_fighter_id }
    )
    const runner_turn = turns.find((t) => t.events.some((e) => e.kind === 'tackled'))
    expect(runner_turn).toBeTruthy()
    const kinds = runner_turn.events.map((e) => e.kind)
    const tackled_i = kinds.indexOf('tackled')
    const move_i = kinds.indexOf('move')
    expect(tackled_i).toBeGreaterThanOrEqual(0)
    expect(move_i).toBeGreaterThan(tackled_i) // hit FIRST, then the move — never after
    const tackled_beat = runner_turn.events[tackled_i]
    const move_beat = runner_turn.events[move_i]
    expect(tackled_beat.duration).toBeGreaterThan(0) // a real presentation hold — never merged into the move
    expect(move_beat.at).toBeGreaterThanOrEqual(tackled_beat.at + tackled_beat.duration) // strictly before, disjoint
    expect(tackled_beat.payload.target_id).toBe(CHAR)
    expect(tackled_beat.payload.mp_lost).toBe(2) // coerced numbers ride the payload for the renderer's floater
    expect(tackled_beat.payload.ap_lost).toBe(3)
  })

  test('DENIAL ALONE (no retry): the tackled beat still presents — the MP forfeit is the beat', () => {
    const { events } = produce_receipt_render_turns(
      [raw('TurnStarted', { is_mob: false, idx: '0', deadline_ms: '90000' }), TACKLED],
      { fight_id: FIGHT, grid_width: 20, resolve_fighter_id }
    )
    const beat = events.find((e) => e.kind === 'tackled')
    expect(beat).toBeTruthy()
    expect(beat.payload.mp_lost).toBe(2)
  })

  test('a MOB runner tackled by the zone presents on the mob id', () => {
    const { events } = produce_receipt_render_turns(
      [raw('Tackled', { runner_is_mob: true, runner_idx: '1', ap_lost: '1', mp_lost: '1', num: '6', den: '12' })],
      { fight_id: FIGHT, grid_width: 20, resolve_fighter_id }
    )
    const beat = events.find((e) => e.kind === 'tackled')
    expect(beat?.payload.target_id).toBe('mob-1')
  })
})

describe('apply_action — the Tackled fold adopts the chain-stripped pools', () => {
  const seeded = () =>
    fold_log(
      [
        // TurnStarted seeds the runner's overlay pools (the begin_turn refill prediction) — the base the strip lands on.
        { kind: 'TurnStarted', is_mob: false, idx: 0, ap: 6, mp: 3, version: 1, event_idx: 0 },
      ],
      FIGHT
    )

  test('the runner loses exactly the emitted deltas, floored at 0 (string fields coerced)', () => {
    const state = apply_action(seeded(), {
      kind: 'Tackled',
      runner_is_mob: false,
      runner_idx: '0',
      ap_lost: '3',
      mp_lost: '2',
      version: 2,
      event_idx: 1,
    })
    expect(state.fighters.p0.ap).toBe(3)
    expect(state.fighters.p0.mp).toBe(1)
  })

  test('over-strip floors at 0, never negative', () => {
    const state = apply_action(seeded(), {
      kind: 'Tackled',
      runner_is_mob: false,
      runner_idx: 0,
      ap_lost: 99,
      mp_lost: 99,
      version: 2,
      event_idx: 1,
    })
    expect(state.fighters.p0.ap).toBe(0)
    expect(state.fighters.p0.mp).toBe(0)
  })

  test('no overlay pools yet (no TurnStarted folded): the strip is a no-op — the object read reconciles', () => {
    const state = apply_action(fold_log([], FIGHT), {
      kind: 'Tackled',
      runner_is_mob: false,
      runner_idx: 0,
      ap_lost: 3,
      mp_lost: 2,
      version: 2,
      event_idx: 1,
    })
    expect(state.fighters.p0?.ap ?? null).toBe(null)
    expect(state.fighters.p0?.mp ?? null).toBe(null)
  })
})
