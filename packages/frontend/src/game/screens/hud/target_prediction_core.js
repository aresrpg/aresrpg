// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The STORE-FREE core of the board-hover cast preview — show exactly what will happen: damage
// taken, critical chance, effects, kill. Isolated from the React hook's store/auth graph (which needs a browser
// window) so the unit test drives it through the REAL fight core + spell corpus without a DOM — the same
// separation target_outcome.js keeps for the pure derivation. It ASSEMBLES predict_cast's inputs from the live
// fight view + dungeon escrow (mirroring DungeonBoard.optimistic_cast) and runs the ONE damage home twice —
// never a second formula. The hook (use_target_prediction.js) only feeds it the three live slices.

import { predict_cast, weapon_spell_template } from '@aresrpg/fight/predict_cast'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'
import { encode } from '@aresrpg/fight/los'

import { fight_spell } from './fight-spells.js'

export const EMPTY_PREDICTION = Object.freeze({ base: null, crit: null, crit_chance: 0, effects: [], target_ref: null })

// Effect kinds already shown by the head life-swing (immediate hp) or the push/pull line — excluded from the
// itemised "effects the cast applies" list so a plain damage spell doesn't repeat its number as a ranged row
// (the authored range was the original bug). Everything else (DoT, states, stat/point changes, buffs)
// is the "what else" the cast does and rides the shared effect formatter in the card.
const HEAD_OR_MOVE_KINDS = new Set(['DAMAGE', 'HEAL', 'PERCENT_LIFE', 'LIFE_STEAL', 'PUSH', 'PULL', 'TELEPORT'])

/** crit RATE (1-in-X, 0 = never) → the shown crit CHANCE percent (mirrors spell_formula::crit_at's bp threshold). */
export const crit_percent = (crit_rate) => (crit_rate > 0 ? Math.round(10000 / crit_rate) / 100 : 0)

/**
 * The armed id → { sim template, crit rate, secondary effect rows, AP cost }. The WEAPON strike prices off the
 * seat's on-chain Weapon (no seed row, no itemised effects); a spell rides its FightSpell corpus row. `ap_cost`
 * feeds the castable-now gate below (mirrors wash_armed_spell's own cost derivation — one formula, two call
 * sites, never a second one invented here). Extracted so the assembly below reads as one flow.
 * @param {string} armed @param {any} me the caster's escrow row (weapon source)
 * @returns {{ template: any, crit_rate: number, effects: any[], ap_cost: number }}
 */
const resolve_armed_spell = (armed, me) => {
  if (armed === WEAPON_ATTACK_ID) {
    const weapon = me?.weapon
    return {
      template: weapon_spell_template(weapon),
      crit_rate: Number(weapon?.crit_rate ?? 0),
      effects: [],
      ap_cost: Number(weapon?.ap_cost ?? 0),
    }
  }
  const level = fight_spell(armed)?.levels?.[0]
  return {
    template: fight_spell(armed)?.template ?? null,
    crit_rate: Number(level?.crit_rate ?? 0),
    effects: level?.effects ?? [],
    ap_cost: Number(level?.ap ?? 0),
  }
}

/**
 * entity id → { is_mob, idx } against the live dungeon escrow — the SAME mapping DungeonBoard.resolve_ref uses (a
 * mob rides 'mob-N', a player rides its escrow seat). null when the id is not a live fighter.
 * @param {any} dungeon @param {string | null | undefined} fighter_id
 * @returns {{ is_mob: boolean, idx: number } | null}
 */
export const resolve_dungeon_ref = (dungeon, fighter_id) => {
  const mob = /^mob-(\d+)$/.exec(String(fighter_id))
  if (mob) return { is_mob: true, idx: Number(mob[1]) }
  const idx =
    dungeon?.escrow?.findIndex((row) => String(row.character ?? row.character_id) === String(fighter_id)) ?? -1
  return idx < 0 ? null : { is_mob: false, idx }
}

/**
 * The live prediction of the armed spell on the hovered target. Runs predict_cast TWICE — critical:false for the
 * guaranteed `base` outcome, critical:true for the `crit` outcome (only when the spell can crit) — so the card
 * shows the non-crit floor AND the crit ceiling. Both bypass the turn-seed clock (a preview is a planning aid,
 * not the live roll): the base is ALWAYS resolvable, never the crit-null blank. Returns EMPTY_PREDICTION whenever
 * nothing is armed / hovered / it is not a live dungeon fight — OR the armed action isn't castable RIGHT NOW
 * (not my turn, mid-presentation, or its AP cost is no longer affordable). CRIT-DISPLAY BUG: armed_spell_id
 * survives turns and spent AP by design (store.js clears it ONLY on an actual Cast — a re-arm-free convenience
 * for next turn), so without this gate a spell armed-but-never-fired keeps forecasting a crit CHANCE against
 * whatever you're hovering — including mid the opponent's turn, or the instant your OWN last action (a different
 * cast, a move) spends the AP this one needed — reading exactly like a probability attached to a hit that
 * already landed. Mirrors the identical two facts @aresrpg/fight/project.turn_input_armed + the adapter's
 * wash_armed_spell already gate the board's OWN targeting-range wash on — never a heuristic, the same pipeline.
 * @param {{ fight: any, hover: any, dungeon: any }} args
 * @returns {{ base: any, crit: any, crit_chance: number, effects: any[], target_ref: { is_mob: boolean, idx: number } | null }}
 */
export const compute_target_prediction = ({ fight, hover, dungeon }) => {
  const armed = fight?.armed_spell_id ?? null
  const caster_id = fight?.my_entity_id ?? null
  const hovered_id = hover?.entity_id ?? null
  const target = fight && hovered_id ? fight.fighters.get(hovered_id) : null
  const target_ref = resolve_dungeon_ref(dungeon, hovered_id)
  if (!armed || !caster_id || !dungeon || !target?.cell || !target_ref) return EMPTY_PREDICTION

  // CASTABLE-NOW GATE, part 1 (turn ownership): a forecast is only legitimate while it's actually your move.
  const my_turn = fight.active_entity_id === caster_id && (fight.winner ?? -1) === -1 && !fight.presenting
  if (!my_turn) return EMPTY_PREDICTION

  const me = dungeon.escrow?.find((p) => (p.character ?? p.character_id) === caster_id) ?? null
  const { template, crit_rate, effects, ap_cost } = resolve_armed_spell(armed, me)
  if (!template) return EMPTY_PREDICTION
  // CASTABLE-NOW GATE, part 2 (affordability): the same AP check wash_armed_spell applies to the range highlight
  // — spent budget ⇒ no forecast, exactly like the board's blue ranges already clear.
  if ((fight.fighters.get(caster_id)?.ap ?? 0) < ap_cost) return EMPTY_PREDICTION

  // resolve_ref / stats_of mirror DungeonBoard.optimistic_cast (the board's live cast home): the tooltip preview
  // and the real cast resolve refs + stats IDENTICALLY, so the previewed number is exactly what the cast lands.
  const resolve_ref = (id) => resolve_dungeon_ref(dungeon, id)
  const stats_of = (id) => {
    const ref = resolve_ref(id)
    const stat_row = ref?.is_mob ? dungeon.mobs?.[ref.idx] : dungeon.escrow?.[ref?.idx]
    return { agility: Number(stat_row?.agility ?? 0) }
  }
  // engine_view fighter cells are DECODED {x,y}; predict_cast's target_cell is an ENCODED int (it decode()s it),
  // so encode here — passing the raw {x,y} decode()s to NaN → an off-board target → no Hit (the live-silence bug).
  const target_cell = encode(target.cell.x, target.cell.y)
  const cast = (critical) =>
    predict_cast({ view: fight, caster_id, spell: template, target_cell, critical, resolve_ref, stats_of })

  const crit_chance = crit_percent(crit_rate)
  return {
    base: cast(false),
    crit: crit_chance > 0 ? cast(true) : null,
    crit_chance,
    effects: effects.filter((fx) => !HEAD_OR_MOVE_KINDS.has(fx.kind)),
    target_ref,
  }
}
