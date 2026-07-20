import { describe, test, expect } from 'bun:test'

import { local_move_beats, local_intent_beats, pace_segment, synthetic_cast_events } from './present.js'
import { DISPLACE_TELEPORT } from './fight_render_prims.js'

// ── S2 FIGHT-FLIP CRASH regression (mobile, v1.12.28) ──────────────────────────────────────────
// Error boundary "SOMETHING WENT WRONG": `s is not a function. (In 's?.(e,t,c,i)', 's' is an instance of
// Array)` — game chunk → GameWorldHud → index. The minified `s?.(e,t,c,i)` is verbatim
// `move_path?.(event, source_id, known_from, to)` in fight_render_events.produce_receipt_render_turns: its
// `move_path` option is a RESOLVER function called PER Moved event. DungeonBoard.optimistic_walk (fired from
// the board cell-click's effect — hence the error boundary catch) fed that option the RAW drafted-path ARRAY,
// so the producer "called" the array → TypeError. local_move_beats is the one home that bridges the known
// drafted path (data) to the resolver contract; this locks the shape so no call site re-breaks it.
describe('local_move_beats — optimistic move draft (S2 flip crash regression)', () => {
  const FIGHT = `0x${'b'.repeat(64)}`
  // A drafted BFS path (decoded cells), exactly what optimistic_walk hands over. Non-empty ⇒ the producer must
  // return it verbatim as the `move` beat's path (never re-derive), so an array passed as the resolver crashes.
  const PATH = [
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
  ]
  const DEST = 4 + 6 * 20 // encoded {x:4,y:6} at grid_width 20 — the path's last cell

  test('renders a move beat tracing the drafted path — the array is never invoked as a function', () => {
    let beats
    // RED before the shape fix: throws "move_path is not a function" — the drafted array called as move_path?.().
    expect(() => {
      beats = local_move_beats({ fight_id: FIGHT, character: 'player-0', to_cell: DEST, path: PATH })
    }).not.toThrow()
    const move = beats.find((b) => b.kind === 'move')
    expect(move).toBeDefined()
    expect(move.payload.path).toEqual(PATH)
  })
})

// ── TELEPORT PRESENTATION LANE — the teleport sequences after the vfx, with its own vfx at the target too:
// a teleport-class cast wave must present ① the origin cast VFX ② the
// model's blink to the target cell, GATED behind the cast beat's full duration (never simultaneous, never
// earlier) ③ an arrival VFX at the target cell. RED before this fix: only 2 beats ever existed (cast,
// displacement) — no arrival beat, on EITHER the receipt-shaped local-intent pipeline or the mob-turn-paced
// pipeline (present.js pace_segment, the SAME displacement_leg shape a push/pull slide already uses).
describe('teleport-class cast — beat order + gating + anchors (present-level fixture)', () => {
  const FIGHT = '0xf1'
  const GRID_W = 20
  const FROM_CELL = 10 // {x:10,y:0}
  const TO_CELL = 42 // {x:2,y:2}
  const resolve_fighter_id = ({ is_mob, idx, character }) =>
    character != null ? String(character) : is_mob ? `mob-${idx}` : `player-${idx}`
  const raw_events = () =>
    synthetic_cast_events({
      fight_id: FIGHT,
      caster_is_mob: false,
      caster_idx: 0,
      target_cell: TO_CELL,
      displacements: [
        { is_mob: false, idx: 0, from_cell: FROM_CELL, to_cell: TO_CELL, effect_kind: DISPLACE_TELEPORT, requested: 1 },
      ],
    })

  test('local_intent_beats (my own predicted-cast shape): cast → displacement → teleport_arrival, gated + anchored', () => {
    const beats = local_intent_beats(raw_events(), { fight_id: FIGHT, resolve_fighter_id })
    expect(beats.map((b) => b.kind)).toEqual(['cast', 'displacement', 'teleport_arrival'])
    const [cast, displacement, arrival] = beats
    // GATED: the blink never renders before the cast beat's own duration has fully elapsed (the render queue
    // waits `turn_started_at + at`, so `at` IS the wall-clock gate — never earlier, never simultaneous).
    expect(displacement.at).toBe(cast.duration)
    expect(arrival.at).toBeGreaterThanOrEqual(displacement.at + displacement.duration)
    // ANCHORS: the blink lands the caster on TO_CELL, and the arrival puff mounts on that SAME landing cell.
    expect(displacement.payload.to).toEqual({ x: 2, y: 2 })
    expect(arrival.payload.cell).toEqual({ x: 2, y: 2 })
    expect(arrival.duration).toBeGreaterThan(0) // a real, visible beat — never a degenerate 0ms marker
  })

  test('pace_segment non-local (mob-turn-paced) wave: same order + gating survives the 3s-slot rescale', () => {
    const { turns } = pace_segment(raw_events(), { fight_id: FIGHT, resolve_fighter_id }, { is_local: () => false })
    const [turn] = turns
    expect(turn.beats.map((b) => b.kind)).toEqual(['cast', 'displacement', 'teleport_arrival'])
    const [cast, displacement, arrival] = turn.beats
    expect(displacement.at).toBe(cast.at + cast.duration)
    expect(arrival.at).toBeGreaterThanOrEqual(displacement.at + displacement.duration)
    expect(turn.duration).toBe(3000) // the tuned mob-turn slot — untouched by the new beat
  })

  // DISPLACEMENT LEG (present.js:80-83 precedent): MY OWN receipt turn splits its slide beats into a SEPARATE
  // local turn at natural pace — a teleport's own `displacement` is 0ms (register #26 — a blink, not a lerp), so
  // before this fix the leg degenerated to a 0/0 turn. The `teleport_arrival` beat now rides the SAME leg,
  // giving it a real, non-zero, gated length.
  test('pace_segment LOCAL turn: the displacement_leg carries the arrival beat at a real, non-zero duration', () => {
    const { turns } = pace_segment(raw_events(), { fight_id: FIGHT, resolve_fighter_id }, { is_local: () => true })
    const leg = turns.find((t) => t.displacement_leg)
    expect(leg).toBeDefined()
    expect(leg.duration).toBeGreaterThan(0)
    expect(leg.beats.map((b) => b.kind)).toEqual(['displacement', 'teleport_arrival'])
    expect(leg.beats[1].duration).toBeGreaterThan(0)
  })
})
