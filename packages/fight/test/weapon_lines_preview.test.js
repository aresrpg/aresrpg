// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1323 leg 1 — THE PARITY FIXTURE for the seat's AUTHORED weapon lines.
//
// The chain resolves a weapon strike from the seat's authored item lines and only falls back to the
// participant's single family `Weapon` when it has none (`cast.move` weapon_damage_total: `lines.is_empty()`
// ⇒ the `fb_*` arm, otherwise Σ over the lines). Each line is rolled with the SAME per-strike
// `slot_damage_roll`, amplified by the caster's element-primary stat and resisted by the TARGET's own
// per-element resist — byte-identical to how a multi-element spell applies.
//
// The client used to have no concept of those lines at all: `normalize_weapon` decoded the family `Weapon`
// and nothing else, so a seat wearing a two-element weapon was previewed at its weapon-FAMILY constant while
// the chain settled Σ(lines). Different numbers by construction.
//
// This fixture pins the seam end to end, from the shape the chain delivers (gRPC `.fields` nesting,
// u64-as-string) through the real decode door into the real preview:
//
//   1. LINES WIN      — the previewed swing is Σ(lines), never the family line's number.
//   2. PER-ELEMENT    — each line meets the TARGET's own resist (the fire line resisted, the water one not),
//                       which is the whole reason lines exist instead of one summed blob.
//   3. ONE ROLL       — every line maps the same per-strike `damage_roll` onto its own band, so the total is
//                       a FUNCTION of (turn_seed, slot) and the preview is the settlement.
//   4. FALLBACK       — a seat with NO lines still prices off the family `Weapon`, byte-identical to before.
//
// The expected numbers are computed from `@aresrpg/sim`'s own `roll_in_range` / `slot_damage_roll` — the twin
// of `spell_formula::roll_in_range` / `slot_damage_roll` the chain calls. No damage arithmetic is
// re-implemented here; the seat and the mob carry zero offensive stats so §5h amplification is unity and the
// only transform left is the resist this file states explicitly.

import { describe, test, expect } from 'bun:test'
import { roll_in_range, slot_damage_roll, turn_seed } from '@aresrpg/sim/turn_seed'

import { board_state_from_fight } from '../src/board_state.js'
import { engine_view } from '../src/project.js'
import { predict_cast, weapon_spell_template } from '../src/predict_cast.js'
import { create_fight_store } from '../src/store.js'
import { encode } from '../src/los.js'
import { LOCAL_ADDRESS, arena_from_board, create_sim_chain, derive_board, snapshot_from_sim } from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:1323:lines'
const WORLD = '0xworld'
const ME = 'seat_a'
const NOW = 1_784_752_468_344
const MOB_HP = 4000 // deep enough that no swing is truncated — every roll is observable in full

// The §7 clock the preview rolls against (the same tuple `crit_clock_of` composes in production).
const CLOCK = { world_seed: 0x51ee7, spawn_id: 7, turn_deadline_ms: NOW + 30_000, seat: 0 }
const SLOTS = [...Array(16).keys()]

// The seat's FAMILY line (participant.move `Weapon`) — deliberately a different element and a fixed, distinct
// number, so a preview that reads it instead of the lines is loudly wrong rather than coincidentally right.
const FAMILY_WEAPON = {
  fields: {
    element: 2, // EARTH — no line carries it
    damage: '7',
    damage_max: '7',
    crit_damage: '11',
    crit_damage_max: '11',
    crit_rate: '0',
    ap_cost: '3',
    reach: '1',
  },
}

// The AUTHORED lines the chain seats from the equipped item (fight.move y117 → participant::WeaponLine),
// exactly as gRPC nests and stringifies them.
const FIRE_LINE = { element: 0, damage: '10', damage_max: '20', crit_damage: '15', crit_damage_max: '30' }
const WATER_LINE = { element: 1, damage: '5', damage_max: '9', crit_damage: '7', crit_damage_max: '13' }
const WIRE_LINES = [{ fields: FIRE_LINE }, { fields: WATER_LINE }]

/** Every stat zeroed — amplification is unity and resistance nil, so a hit IS the rolled base. */
const ZERO_STATS = {
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  raw_damage: 0,
  critical_hit: 0,
  range: 0,
  fire_resistance: 0,
  water_resistance: 0,
  earth_resistance: 0,
  air_resistance: 0,
}

const entity = (id, cell, is_player, stats = ZERO_STATS) => ({
  id,
  name: id,
  cell,
  health: MOB_HP,
  health_max: MOB_HP,
  ap: 99,
  ap_max: 99,
  mp: 4,
  mp_max: 4,
  ap_used: 0,
  mp_used: 0,
  is_player,
  template_id: is_player ? 'senshi' : '0xmob_template',
  level: 20,
  effects: [],
  ap_reserve: 0,
  stats,
  spell_levels: {},
})

/** A live fight whose seat carries `lines` (null ⇒ no lines at all: the family-fallback case). */
const fixture = ({ lines, mob_stats = ZERO_STATS }) => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  const chain = create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [entity(ME, arena.spawns_a[0], true)],
    // ADJACENT: the weapon template hardcodes line_of_sight and reach 1 — a distant mob is refused, not measured.
    team1: [entity('mob_0', arena.spawns_a[1], false, mob_stats)],
    templates_raw: [],
    group_template: '0xgroup',
  })
  const raw = snapshot_from_sim(chain, { now_ms: NOW })
  // The chain-SHAPED read: the seat's family Weapon inline on the participant, its authored lines seat-keyed
  // (the engine stores them as a per-seat dynamic field, so they arrive beside the object, not inside it).
  const snapshot = {
    ...raw,
    participants: raw.participants.map((p) => ({ ...p, weapon: FAMILY_WEAPON })),
    ...(lines ? { weapon_lines: { 0: lines } } : {}),
  }
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT_ID,
      ctx: { world_id: WORLD, my_entity_id: ME, address: LOCAL_ADDRESS, beat_ctx: { grid_width: 20 } },
    },
    NOW
  )
  store.getState().input({ type: 'snapshot', fight: snapshot, version: 1 }, NOW + 100)
  const board_view = board_state_from_fight({ fight: snapshot, version: 1 })
  return {
    weapon: board_view.escrow.find((row) => String(row.character) === ME).weapon,
    view: engine_view(store.getState()),
    board: board_view,
    mob_cell: chain.sim_state.team1[0].cell,
  }
}

const ref_of = (board) => (id) => {
  const mob = /^mob-(\d+)$/.exec(String(id))
  if (mob) return { is_mob: true, idx: Number(mob[1]) }
  const idx = board.escrow.findIndex((row) => String(row.character) === String(id))
  return idx < 0 ? null : { is_mob: false, idx }
}

/** One swing on §7 slot `slot`, returned as the damage the mob actually took. */
const swing = ({ weapon, view, board, mob_cell }, slot) => {
  const hit = predict_cast({
    view,
    caster_id: ME,
    spell: weapon_spell_template(weapon),
    spell_level: 1,
    target_cell: encode(mob_cell.x, mob_cell.y),
    critical: false, // the crit swap is its own branch; this file measures the NORMAL band
    critical_clock: { ...CLOCK, slot },
    resolve_ref: ref_of(board),
  }).actions.find((action) => action.kind === 'Hit' && action.victim_is_mob)
  return hit ? MOB_HP - hit.remaining_hp : null
}

/** The per-strike roll fraction the chain maps onto EVERY line of the strike (`spell_formula::slot_damage_roll`). */
const roll_at = (slot) => slot_damage_roll(turn_seed({ ...CLOCK, slot }), slot)

/** Σ over the authored lines at `slot`, each line's own band rolled with the ONE shared roll — cast.move's
 *  `weapon_damage_total` stated in the sim's own vocabulary. `resist` is the applied (already-capped) percent
 *  the target owns for that line's element. */
const expected_total = (slot, resist = { 0: 0, 1: 0 }) =>
  [FIRE_LINE, WATER_LINE].reduce((total, line) => {
    const base = roll_in_range(Number(line.damage), Number(line.damage_max), roll_at(slot))
    return total + Math.floor((base * (100 - (resist[line.element] ?? 0))) / 100)
  }, 0)

describe('#1323 — the preview resolves the seat’s AUTHORED lines, exactly as the chain does', () => {
  const seated = fixture({ lines: WIRE_LINES })

  test('the seat’s lines survive the decode onto the weapon the preview prices from', () => {
    // Guard the guard: with no lines on the weapon every assertion below would silently measure the family line.
    expect(seated.weapon.lines).toHaveLength(2)
    expect(seated.weapon.lines[0]).toEqual({
      element: 0,
      damage: 10,
      damage_max: 20,
      crit_damage: 15,
      crit_damage_max: 30,
    })
    expect(seated.weapon.lines[1]).toEqual({
      element: 1,
      damage: 5,
      damage_max: 9,
      crit_damage: 7,
      crit_damage_max: 13,
    })
  })

  test('the preview template carries ONE effect per authored line, each keyed to its own element', () => {
    const [level] = weapon_spell_template(seated.weapon).levels
    expect(level.base_effects.map((fx) => [fx.element, fx.min, fx.max])).toEqual([
      ['FIRE', 10, 20],
      ['WATER', 5, 9],
    ])
    expect(level.crit_effects.map((fx) => [fx.element, fx.min, fx.max])).toEqual([
      ['FIRE', 15, 30],
      ['WATER', 7, 13],
    ])
  })

  test('LINES WIN — every previewed swing is Σ(lines) at that slot’s roll, never the family line', () => {
    // The defect's signature: the family `Weapon` is a fixed 7, so a family-priced preview deals 7 every slot.
    const damages = SLOTS.map((slot) => swing(seated, slot))
    expect(damages).toEqual(SLOTS.map((slot) => expected_total(slot)))
    expect(damages.every((amount) => amount !== 7)).toBe(true)
  })

  test('ONE ROLL, MANY BANDS — the total moves with the slot and stays inside the summed band', () => {
    const damages = SLOTS.map((slot) => swing(seated, slot))
    expect(new Set(damages).size).toBeGreaterThan(1) // a collapsed band would be one number forever
    expect(damages.every((amount) => amount >= 10 + 5 && amount <= 20 + 9)).toBe(true)
    expect(SLOTS.map((slot) => swing(seated, slot))).toEqual(damages) // deterministic ⇒ previewable
  })

  test('PER-ELEMENT — the target’s fire resist bites the fire line and leaves the water line whole', () => {
    // 60 is exactly the chain's applied-resistance cap, so the fire line lands at 40% and the water line, whose
    // element the mob does not resist at all, is untouched. A single summed blob could not produce this split.
    const resistant = fixture({ lines: WIRE_LINES, mob_stats: { ...ZERO_STATS, fire_resistance: 60 } })
    const damages = SLOTS.map((slot) => swing(resistant, slot))
    expect(damages).toEqual(SLOTS.map((slot) => expected_total(slot, { 0: 60, 1: 0 })))
    // …and it genuinely differs from the unresisted read, so the assertion above is not vacuous.
    expect(damages).not.toEqual(SLOTS.map((slot) => swing(seated, slot)))
  })
})

describe('#1323 — a seat with NO authored lines still prices off the family Weapon', () => {
  const bare = fixture({ lines: null })

  test('the decoded weapon carries no lines and the template keeps its single family effect', () => {
    expect(bare.weapon.lines).toEqual([])
    const [level] = weapon_spell_template(bare.weapon).levels
    expect(level.base_effects.map((fx) => [fx.element, fx.min, fx.max])).toEqual([['EARTH', 7, 7]])
  })

  test('every swing is the family line’s fixed 7 — the pre-line path, byte-identical', () => {
    expect(SLOTS.map((slot) => swing(bare, slot))).toEqual(SLOTS.map(() => 7))
  })
})
