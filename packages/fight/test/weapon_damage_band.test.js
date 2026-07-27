// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #577 / #965 — THE SWORD CASE. Reported from live hack-mode play: "feels like there is an issue with my sword,
// can you double check if damages are properly rolled instead of always using the low band" — Senshi's Wooden
// Sword, an authored 16–29 EARTH line that dealt 16 every single swing.
//
// That report is the whole wave in one sentence. The deployed foundation package already EXPORTS the range-roll
// system (`slot_damage_roll` / `crank_damage_roll` / `roll_in_range`, and `Effect.value_max`), but edge's sim and
// client never carried it: `normalize_effect` read `value` and dropped `value_max`, so every band collapsed onto
// its floor before the resolver ever saw it. A weapon strike is the most visible surface of that bug because a
// player swings it every turn.
//
// The three assertions are the acceptance rider for this wave, and they are exactly the three things a player
// means by "properly rolled":
//   1. DISTRIBUTION — successive swings are not all the same number (the reported symptom, inverted).
//   2. BOUNDS       — every swing lands inside the authored band, never outside it.
//   3. DETERMINISM  — the same §7 turn-seed slot always yields the same swing, so the client can PREVIEW it and
//                     a replay reproduces it. Variance without determinism would just be a different bug.
//
// The seat and the mob carry ZERO offensive stats and ZERO resistances on purpose: the §5h amplification is then
// unity and resistance nil, so the observed hit IS the rolled base and the band can be asserted literally. No
// damage arithmetic is re-implemented here.

import { describe, test, expect } from 'bun:test'

import { board_state_from_fight } from '../src/board_state.js'
import { engine_view } from '../src/project.js'
import { predict_cast, weapon_spell_template } from '../src/predict_cast.js'
import { create_fight_store } from '../src/store.js'
import { encode } from '../src/los.js'
import {
  LOCAL_ADDRESS,
  arena_from_board,
  create_sim_chain,
  derive_board,
  snapshot_from_sim,
} from '../src/sim_chain.js'

const SEED = 0xc81f3a92
const FIGHT_ID = 'sim:577:sword'
const WORLD = '0xworld'
const ME = 'seat_a'
const NOW = 1_784_752_468_344

// Senshi's Wooden Sword, as authored: an EARTH line that rolls 16–29 per swing.
const SWORD = { element: 2, damage: 16, damage_max: 29, crit_rate: 0, ap_cost: 3 }

/** Every stat zeroed — amplification is unity, resistance is nil, so a hit IS the rolled base. */
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

const entity = (id, cell, is_player, health = 4000) => ({
  id,
  name: id,
  cell,
  health, // default deep enough that N swings never kill and every swing is observable
  health_max: health,
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
  stats: ZERO_STATS,
  spell_levels: {},
})

const boot = (mob_health = 4000) => {
  const { board } = derive_board(SEED)
  const arena = arena_from_board(board)
  return create_sim_chain({
    seed: SEED,
    fight_id: FIGHT_ID,
    team0: [entity(ME, arena.spawns_a[0], true)],
    // ADJACENT, on the neighbouring spawn cell: a sword is reach-1, and `weapon_spell_template` hardcodes
    // line_of_sight — put the mob across the carved board and every swing is refused for LOS, not measured.
    team1: [entity('mob_0', arena.spawns_a[1], false, mob_health)],
    templates_raw: [],
    group_template: '0xgroup',
  })
}

const adopt = (chain) => {
  const snapshot = snapshot_from_sim(chain, { now_ms: NOW })
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
  return { board: board_state_from_fight({ fight: snapshot, version: 1 }), view: engine_view(store.getState()) }
}

const ref_of = (board) => (id) => {
  const mob = /^mob-(\d+)$/.exec(String(id))
  if (mob) return { is_mob: true, idx: Number(mob[1]) }
  const idx = board.escrow.findIndex((row) => String(row.character) === String(id))
  return idx < 0 ? null : { is_mob: false, idx }
}

const TEMPLATE = weapon_spell_template({ ...SWORD, reach: 1 })
const SLOTS = [...Array(16).keys()]

/** One swing of the sword on §7 turn slot `slot`, over `fixture`, returned as the HP the mob is left on. */
const swing_remaining = ({ board, view, mob_cell }, slot) =>
  predict_cast({
    view,
    caster_id: ME,
    spell: TEMPLATE,
    spell_level: 1,
    target_cell: encode(mob_cell.x, mob_cell.y),
    critical: false, // the crit branch is its own swap; this file measures the NORMAL band
    critical_clock: { world_seed: 0x51ee7, spawn_id: 7, turn_deadline_ms: NOW + 30_000, seat: 0, slot },
    resolve_ref: ref_of(board),
  }).actions.find((action) => action.kind === 'Hit' && action.victim_is_mob)?.remaining_hp

/** A booted fixture at `mob_health`, adopted through the production snapshot door. */
const fixture_at = (mob_health) => {
  const chain = boot(mob_health)
  const { board, view } = adopt(chain)
  return {
    board,
    view,
    seat_cell: chain.sim_state.team0[0].cell,
    mob_cell: chain.sim_state.team1[0].cell,
  }
}

// The DEEP fixture: 4000 HP, so no swing can be truncated by the victim's remaining HP and every roll is
// observable in full. Both describes below read this one measurement — the kill-threshold block derives its
// expected death set from these exact numbers, so the two can never drift apart.
const DEEP = fixture_at(4000)
const damages = SLOTS.map((slot) => 4000 - swing_remaining(DEEP, slot))

describe('#577 — the sword rolls its band instead of always swinging the low bound', () => {
  const { seat_cell, mob_cell } = DEEP
  const template = TEMPLATE

  test('the fixture actually swings — an adjacent mob, in reach, taking real hits', () => {
    // Guard the guard: a refused cast yields no Hit row, and `4000 - undefined` is NaN — which would make the
    // distribution and bounds assertions below meaningless rather than red. Prove the swings landed first.
    expect(Math.abs(seat_cell.x - mob_cell.x) + Math.abs(seat_cell.y - mob_cell.y)).toBe(1)
    expect(damages.every((amount) => Number.isInteger(amount) && amount > 0)).toBe(true)
  })

  test('the authored band survives the decode — the weapon template carries 16 AND 29 (#965)', () => {
    // The decode door #965 named: `normalize_effect` used to drop `value_max`, so min === max === 16 here and
    // every downstream roll was a no-op. This is the assertion that the band reaches the resolver at all.
    const [effect] = template.levels[0].base_effects
    expect(effect.min).toBe(16)
    expect(effect.max).toBe(29)
  })

  test('DISTRIBUTION — successive swings are NOT all the same number (the reported symptom)', () => {
    // The bug's signature verbatim: every swing landing 16. Any two swings differing disproves it; the report
    // said "always the low band", so the low-bound-only case is called out explicitly below.
    expect(new Set(damages).size).toBeGreaterThan(1)
    expect(damages.some((amount) => amount > 16)).toBe(true)
  })

  test('BOUNDS — every swing lands inside the authored 16–29 band, never outside', () => {
    // Zero stats ⇒ the hit IS the rolled base, so the authored numbers are the literal bounds.
    expect(damages.every((amount) => amount >= 16 && amount <= 29)).toBe(true)
  })

  test('DETERMINISM — the same turn-seed slot always swings the same number, so it is previewable', () => {
    // Variance alone would be a different bug: the §7 contract is that the roll is a FUNCTION of (turn_seed,
    // slot), which is what lets the client paint the number before committing and lets a replay reproduce it.
    expect(SLOTS.map((slot) => 4000 - swing_remaining(DEEP, slot))).toEqual(damages)
    // …and it is genuinely slot-keyed, not one cached number handed back every time.
    expect(new Set(SLOTS.map((slot) => 4000 - swing_remaining(DEEP, slot))).size).toBe(new Set(damages).size)
  })
})

// ── The second field report: a mob DIED on chain but SURVIVED in the sim ──────────────────────────────────
// Same defect, its most expensive face. A kill threshold is a band question: a target sitting inside the band
// dies to a high roll and lives through a low one. With the band folded flat at its floor the sim could only
// ever deal the minimum, so any target above that minimum was UNKILLABLE in the sim while the chain's in-range
// roll crossed lethal — the prediction says "survives", the receipt says "dead".
//
// Expressed sim-side and deterministically: park a mob strictly INSIDE the 16–29 band and assert the outcome
// actually splits across turn-seed slots. Deliberately not a chain-capture parity assert — this is the
// mechanism that produced the divergence, and it is measurable without a fixture the repo cannot hold.
describe('#577 — the kill threshold moves with the roll (a target inside the band is not immortal)', () => {
  const MOB_HP = 20 // strictly inside 16–29: unreachable at the floor, lethal on a high roll
  const chain = boot(MOB_HP)
  const { board, view } = adopt(chain)
  const mob_cell = chain.sim_state.team1[0].cell
  const template = weapon_spell_template({ ...SWORD, reach: 1 })

  const remaining = (slot) =>
    predict_cast({
      view,
      caster_id: ME,
      spell: template,
      spell_level: 1,
      target_cell: encode(mob_cell.x, mob_cell.y),
      critical: false,
      critical_clock: { world_seed: 0x51ee7, spawn_id: 7, turn_deadline_ms: NOW + 30_000, seat: 0, slot },
      resolve_ref: ref_of(board),
    }).actions.find((action) => action.kind === 'Hit' && action.victim_is_mob)?.remaining_hp

  const outcomes = [...Array(16).keys()].map((slot) => remaining(slot))

  test('some slots KILL the 20 HP mob and some leave it standing — the outcome is roll-decided', () => {
    // Under the flat fold every swing dealt 16, so a 20 HP mob survived every single slot: lethal count 0.
    // That is the reported divergence in one number.
    expect(outcomes.some((hp) => hp === 0)).toBe(true)
    expect(outcomes.some((hp) => hp > 0)).toBe(true)
  })

  test('the split is exactly the band arithmetic — lethal iff that slot rolled >= the mob HP', () => {
    // No tolerance and no sampling: which slots kill is a FUNCTION of the roll, so the kill set is derivable
    // from the damage numbers the band test already measured. Ties the death outcome to the roll, not to luck.
    expect(outcomes.map((hp) => hp === 0)).toEqual(damages.map((amount) => amount >= MOB_HP))
  })
})
