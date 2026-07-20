// §7b DISPLACEMENT/TRAP RENDER GRAMMAR — the RECEIPT-path invariants for a push.
//
// These lock the beat grammar the CHAIN authors: a push renders caster swing → VFX → slide → trap impact, the
// slide walks EXACTLY to the receipt's `to_cell` (never to `requested` — the trap/wall force-stop is the truth),
// and a following trap_trigger fires AT that landing cell. Proven correct here at the fold/beat level for both
// the non-local (mob/peer) receipt turn AND MY OWN turn's windowed displacement_leg (present.js pace_segment).
//
// NOTE: the RECEIPT producers below are correct; the OPTIMISTIC PREDICTION
// lane (predict_cast → produce_predicted_render_events) is where a push overshoots + double-slides, because the
// client sim state carries NO board traps (keyless read drops Fight.fx; predict_cast.state_from_view never
// populates them) — the INC-4 one-object work, out of this module. These guards keep the receipt truth honest.

import { describe, expect, test } from 'bun:test'

import { pace_segment } from './present.js'
import { produce_receipt_render_turns, CAST_BEAT_MS } from './fight_render_events.js'

const FIGHT = 'fight-1'
const W = 20
const enc = (x, y) => y * W + x
const ev = (suffix, fields) => ({ type: `0xE::fight_events::${suffix}`, parsedJson: { fight: FIGHT, ...fields } })

// p0 pushes mob-0 from (5,8). requested 3 → the full slide would land (8,8); the chain force-stops on the trap
// at (7,8), so to_cell=(7,8) is SHORT of requested and a trap Hit follows.
const PUSH_EVENTS = [
  ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: enc(5, 8) }),
  ev('Displaced', {
    target_is_mob: true,
    target_idx: 0,
    kind: 12,
    from_cell: enc(5, 8),
    to_cell: enc(7, 8),
    requested: 3,
    blocked: 0,
  }),
  ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 30, remaining_hp: 70 }),
]
const CTX = {
  fight_id: FIGHT,
  grid_width: W,
  trap_cells: [enc(7, 8)],
  resolve_fighter_id: ({ is_mob, idx, character }) =>
    character != null ? String(character) : `${is_mob ? 'mob' : 'player'}-${idx}`,
  fighter_cells: () => ({ x: 5, y: 8 }),
  resolve_cast: () => ({ spell_id: 'dungeon_strike' }),
}

describe('§7b push grammar — the slide is sequenced AFTER the cast-contact beat (③)', () => {
  test('receipt turn: displacement never starts before the cast VFX window closes', () => {
    const { turns } = produce_receipt_render_turns(PUSH_EVENTS, CTX)
    const beats = turns[0].events
    const cast = beats.find((b) => b.kind === 'cast')
    const disp = beats.find((b) => b.kind === 'displacement')
    expect(cast.at).toBe(0)
    // E1→E7: the slide opens no earlier than the cast beat's end (the swing→VFX window). Never an insta-slide.
    expect(disp.at).toBeGreaterThanOrEqual(cast.at + cast.duration)
    expect(disp.at).toBe(CAST_BEAT_MS)
  })
})

describe('§7b push grammar — the slide walks to to_cell, never to `requested` (④)', () => {
  test('receipt turn: path ends at to_cell and a trap_trigger fires AT to_cell', () => {
    const { turns } = produce_receipt_render_turns(PUSH_EVENTS, CTX)
    const beats = turns[0].events
    const disp = beats.find((b) => b.kind === 'displacement')
    const trap = beats.find((b) => b.kind === 'trap_trigger')
    expect(disp.payload.path.at(-1)).toEqual({ x: 7, y: 8 }) // stops at to_cell (the force-stop)
    expect(disp.payload.path.some((cell) => cell.x >= 8)).toBe(false) // NEVER reaches requested (8,8)
    expect(trap?.payload.cell).toEqual({ x: 7, y: 8 }) // trap detonation at the landing cell
  })

  test('MY OWN turn: the windowed displacement_leg also stops exactly at to_cell', () => {
    const { turns } = pace_segment(PUSH_EVENTS, CTX, { is_local: () => true })
    const leg = turns.find((turn) => turn.displacement_leg)
    expect(leg).toBeDefined()
    const disp = leg.beats.find((b) => b.kind === 'displacement')
    const trap = leg.beats.find((b) => b.kind === 'trap_trigger')
    expect(disp.payload.path.at(-1)).toEqual({ x: 7, y: 8 })
    expect(disp.payload.path.some((cell) => cell.x >= 8)).toBe(false)
    // the leg re-anchors at its own head; the trap boom still follows the slide it detonated
    expect(disp.at).toBe(0)
    expect(trap.at).toBe(disp.duration)
  })
})
