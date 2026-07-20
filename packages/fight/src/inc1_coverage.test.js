// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// INC-1 — receipt coverage: the apply_action arms the fold dropped/misread, the invisibility snapshot mapping,
// and instant teleport (VIOLATION_REGISTER #13 #26 #27 #53). Chain field names are GROUND TRUTH from
// packages/move/engine/sources/fight_events.move (Revealed{is_mob,idx} · Drain{target_*,point_kind,removed} ·
// Abandoned{character,seat} · StanceChanged{fighter_*,stance,active} · CriticalFailure{caster_*}). RED against
// HEAD (no arms / target_* misread / object-vs-id compare / cardinal teleport slide), GREEN after.
import { describe, test, expect } from 'bun:test'

import { apply_action, empty_state } from './inputs.js'
import { base_from_view } from './fold.js'
import { produce_receipt_render_turns } from './fight_render_events.js'

const FIGHT = '0xf1c1'
const seat = (over = {}) => ({
  key: 'p0',
  is_mob: false,
  cell: 10,
  hp: 50,
  ap: 6,
  mp: 3,
  alive: true,
  invisible: false,
  ...over,
})
const with_fighters = (fighters) => ({ ...empty_state(FIGHT), fighters })

describe('INC-1 · apply_action coverage (register #13 — the dropped/misread arms)', () => {
  test('Revealed clears the fighter invisibility', () => {
    let s = with_fighters({ p0: seat({ invisible: true }) })
    s = apply_action(s, { kind: 'Revealed', is_mob: false, idx: 0 })
    expect(s.fighters.p0.invisible).toBe(false)
  })

  test('Drain removes AP (point_kind 0) then MP (point_kind 1) from the overlay pool', () => {
    let s = with_fighters({ p0: seat({ ap: 6, mp: 3 }) })
    s = apply_action(s, { kind: 'Drain', target_is_mob: false, target_idx: 0, point_kind: 0, removed: 2 })
    expect(s.fighters.p0.ap).toBe(4)
    expect(s.fighters.p0.mp).toBe(3)
    s = apply_action(s, { kind: 'Drain', target_is_mob: false, target_idx: 0, point_kind: 1, removed: 1 })
    expect(s.fighters.p0.mp).toBe(2)
  })

  test('Drain on a null overlay pool is a no-op (the object read reconciles — no invented number)', () => {
    let s = with_fighters({ p0: seat({ ap: null, mp: null }) })
    s = apply_action(s, { kind: 'Drain', target_is_mob: false, target_idx: 0, point_kind: 0, removed: 2 })
    expect(s.fighters.p0.ap).toBeNull()
  })

  test('Drain coerces string u64 fields (Sui JSON) and never goes negative', () => {
    let s = with_fighters({ p0: seat({ ap: 1 }) })
    s = apply_action(s, { kind: 'Drain', target_is_mob: false, target_idx: 0, point_kind: '0', removed: '5' })
    expect(s.fighters.p0.ap).toBe(0)
  })

  test('Abandoned sets the seat dead (hp 0, alive false) by seat index', () => {
    let s = with_fighters({ p0: seat({ hp: 50, alive: true }) })
    s = apply_action(s, { kind: 'Abandoned', character: '0xc', seat: 0 })
    expect(s.fighters.p0.hp).toBe(0)
    expect(s.fighters.p0.alive).toBe(false)
  })

  test('StanceChanged reads fighter_* and toggles invisibility on the invisibility stance (27)', () => {
    let s = empty_state(FIGHT)
    s = apply_action(s, { kind: 'StanceChanged', fighter_is_mob: true, fighter_idx: 0, stance: 27, active: true })
    expect(s.fighters.m0.invisible).toBe(true)
    s = apply_action(s, { kind: 'StanceChanged', fighter_is_mob: true, fighter_idx: 0, stance: 27, active: false })
    expect(s.fighters.m0.invisible).toBe(false)
  })

  test('StanceChanged for a non-invisibility stance does not touch invisibility', () => {
    let s = with_fighters({ p0: seat({ invisible: false }) })
    s = apply_action(s, { kind: 'StanceChanged', fighter_is_mob: false, fighter_idx: 0, stance: 3, active: true })
    expect(s.fighters.p0.invisible).toBe(false)
  })

  test('CriticalFailure is recognized and changes no fighter state (AP already debited by the Cast)', () => {
    const before = with_fighters({ p0: seat({ ap: 4 }) })
    const after = apply_action(before, { kind: 'CriticalFailure', caster_is_mob: false, caster_idx: 0 })
    expect(after.fighters.p0.ap).toBe(4)
  })

  test('BRIDGE B-STANCE: the legacy client-intent shape (target_*, invisible) still applies (no regression)', () => {
    // DungeonBoard's optimistic fan-out (out of fence, dies INC-4) dispatches this shape — it must not silently
    // no-op while the chain path uses fighter_*/stance/active.
    let s = empty_state(FIGHT)
    s = apply_action(s, { kind: 'StanceChanged', target_is_mob: false, target_idx: 0, invisible: true })
    expect(s.fighters.p0.invisible).toBe(true)
  })
})

describe('INC-1 · invisibility snapshot mapping (register #53 — object-vs-id compare)', () => {
  const view = {
    id: FIGHT,
    escrow: [{ seat: 0, character: '0xchar', cell: 10, hp: 50, alive: true, ap: 6, mp: 3 }],
    mobs: [{ cell: 20, hp: 20, alive: true, ap: 4, mp: 3 }],
    status: 1, // STATUS_ACTIVE
    turn_queue: [{ is_mob: false, idx: 0 }],
    turn_ptr: 0,
    turn_deadline_ms: 0,
    invisibility_statuses: [
      { entity_id: '0xchar', kind: 27, remaining_turns: 3 },
      { entity_id: 'mob-0', kind: 27, remaining_turns: 2 },
    ],
  }

  test('base_from_view maps invisibility_statuses by entity_id (player + mob), not the whole object', () => {
    const base = base_from_view(view, FIGHT)
    expect(base.fighters.p0.invisible).toBe(true)
    expect(base.fighters.m0.invisible).toBe(true)
  })
})

describe('INC-1 · teleport renders instant (register #26 — kind-14 no cardinal slide)', () => {
  const ev = (name, json) => ({ type: `0xp::fight_events::${name}`, parsedJson: { fight: FIGHT, ...json } })

  test('a kind-14 Displaced produces an INSTANT displacement beat (no cardinal path)', () => {
    const raw = [
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 200 }),
      ev('Displaced', { target_is_mob: false, target_idx: 0, kind: 14, from_cell: 10, to_cell: 200 }),
    ]
    const { events } = produce_receipt_render_turns(raw, { fight_id: FIGHT, grid_width: 20 })
    const disp = events.find((e) => e.kind === 'displacement')
    expect(disp).toBeTruthy()
    expect(disp.duration).toBe(0) // instant — not ~20 cells × 119ms of slide
    expect(disp.payload.path).toEqual([]) // no cardinal path
    expect(disp.payload.to).toEqual({ x: 0, y: 10 }) // lands directly at to_cell 200 on a 20-wide grid
  })

  test('a normal push (kind 12) still slides cardinally', () => {
    const raw = [
      ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 13 }),
      ev('Displaced', { target_is_mob: false, target_idx: 0, kind: 12, from_cell: 10, to_cell: 13 }),
    ]
    const { events } = produce_receipt_render_turns(raw, { fight_id: FIGHT, grid_width: 20 })
    const disp = events.find((e) => e.kind === 'displacement')
    expect(disp.duration).toBeGreaterThan(0) // a real slide
    expect(disp.payload.path.length).toBeGreaterThan(0)
  })
})
