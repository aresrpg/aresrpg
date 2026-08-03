// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The STORE-FREE core of the board-hover cast preview — show exactly what will happen: damage
// taken, critical chance, effects, kill. Isolated from the React hook's store/auth graph (which needs a browser
// window) so the unit test drives it through the REAL fight core + spell corpus without a DOM — the same
// separation target_outcome.js keeps for the pure derivation. It ASSEMBLES predict_cast's inputs from the live
// fight view + dungeon escrow (mirroring DungeonBoard.optimistic_cast) and runs the ONE damage home twice —
// never a second formula. The hook (use_target_prediction.js) only feeds it the three live slices.

import { crit_clock_of, predict_cast, weapon_spell_template } from '@aresrpg/fight/predict_cast'
import { mob_entity_index } from '@aresrpg/fight/project'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'
import { encode } from '@aresrpg/fight/los'

import { fight_spell, seat_spell_level, seat_spell_row } from './fight-spells.js'
import { next_slot_crit, socket_glows } from './deck-crit-glow.js'

export const EMPTY_PREDICTION = Object.freeze({ prediction: null, is_crit: false, effects: [], target_ref: null })

// Effect kinds already shown by the head life-swing (immediate hp) or the push/pull line — excluded from the
// itemised "effects the cast applies" list so a plain damage spell doesn't repeat its number as a ranged row
// (the authored range was the original bug). Everything else (DoT, states, stat/point changes, buffs)
// is the "what else" the cast does and rides the shared effect formatter in the card.
const HEAD_OR_MOVE_KINDS = new Set(['DAMAGE', 'HEAL', 'PERCENT_LIFE', 'LIFE_STEAL', 'PUSH', 'PULL', 'TELEPORT'])

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
      spell_level: 1,
      crit_rate: Number(weapon?.crit_rate ?? 0),
      effects: [],
      ap_cost: Number(weapon?.ap_cost ?? 0),
    }
  }
  // THE SEAT'S RANK (#1077): crit rate, AP cost, the itemised effect rows AND the level the sim runs all come
  // off the row the seat actually casts — its learned level, read from the composed build its escrow row
  // carries. Reading levels[0] here made a rank-6 spell preview its rank-1 numbers.
  const spell = fight_spell(armed)
  const spell_level = seat_spell_level(me, spell)
  const level = seat_spell_row(me, spell)
  return {
    template: spell?.template ?? null,
    spell_level,
    crit_rate: Number(level?.crit_rate ?? 0),
    effects: level?.effects ?? [],
    ap_cost: Number(level?.ap ?? 0),
  }
}

/**
 * THE PREVIEW'S DEPENDENCY SET — the memo key `useTargetPrediction` re-runs the derivation on, living HERE next
 * to the derivation it keys so the two can never be maintained apart. It is the derivation's OWN inputs, never a
 * subset of them: keying on hand-picked aim primitives (the armed id, the caster, the target's cell and hp) named
 * nothing about the CASTER's status block, so a +110% damage buff folded, the card painted it, and the held hover
 * kept serving its pre-buff number (#1480). `fight` is whole and changes exactly once per FOLD — `engine_view_of`
 * memoizes one view per core state — never per frame. `hover` is the one exception, read by ITS ID: the slice is
 * re-created on every pointermove (it carries the cursor's x/y) and `entity_id` is the only field the derivation
 * reads off it, so keying the object would re-run the sim per mouse pixel. The law both halves must satisfy is a
 * pure property this module's test asserts directly: two states with the SAME key derive the SAME prediction.
 * Compared element-wise with Object.is, exactly as React compares a deps array.
 * @param {{ fight: any, hover: any, dungeon: any, slot?: number|null }} args the SAME object handed to
 *   `compute_target_prediction` — one call site, one set of inputs, no second assembly.
 * @returns {any[]}
 */
export const prediction_memo_key = ({ fight, hover, dungeon, slot = null }) => [fight, hover?.entity_id ?? null, dungeon, slot]

/**
 * entity id → { is_mob, idx } against the live dungeon escrow — the SAME mapping DungeonBoard.resolve_ref uses (a
 * mob rides 'mob-N', a player rides its escrow seat). null when the id is not a live fighter.
 * @param {any} dungeon @param {string | null | undefined} fighter_id
 * @returns {{ is_mob: boolean, idx: number } | null}
 */
export const resolve_dungeon_ref = (dungeon, fighter_id) => {
  const mob_idx = mob_entity_index(fighter_id)
  if (mob_idx != null) return { is_mob: true, idx: mob_idx }
  const idx =
    dungeon?.escrow?.findIndex((row) => String(row.character ?? row.character_id) === String(fighter_id)) ?? -1
  return idx < 0 ? null : { is_mob: false, idx }
}

/**
 * The live prediction of the armed spell on the hovered target — the SINGLE resolved outcome the chain will
 * settle. A fight is seed-deterministic, so whether the pending cast crits is a FACT, not a chance: predict_cast
 * runs ONCE on the resolved branch (`is_crit`), and the card shows exactly that number — no base/crit pair, no
 * probability line. Returns EMPTY_PREDICTION whenever nothing is armed / hovered / it is not a live dungeon fight
 * — OR the armed action isn't castable RIGHT NOW (not my turn, mid-presentation, or its AP cost is no longer
 * affordable). CRIT-DISPLAY GATE: armed_spell_id survives turns and spent AP by design (store.js clears it ONLY
 * on an actual Cast — a re-arm-free convenience for next turn), so without this gate a spell armed-but-never-fired
 * keeps forecasting against whatever you're hovering — including mid the opponent's turn, or the instant your OWN
 * last action (a different cast, a move) spends the AP this one needed. Reads the SAME arming fact
 * (`input_armed`) the adapter's wash_armed_spell gates the board's OWN targeting-range wash on — never a
 * heuristic, never a second spelling of it, the same pipeline.
 * @param {{ fight: any, hover: any, dungeon: any, slot?: number|null }} args  `slot` = the pending cast's chain
 *   slot from its ONE home (`project.my_action_slot` — #1224), so the tooltip advances with the draft exactly
 *   like the glow, follows a turn the chain already restarted, and never prices off a second count.
 * @returns {{ prediction: any, is_crit: boolean, effects: any[], target_ref: { is_mob: boolean, idx: number } | null }}
 */
export const compute_target_prediction = ({ fight, hover, dungeon, slot = null }) => {
  const armed = fight?.armed_spell_id ?? null
  const caster_id = fight?.my_entity_id ?? null
  const hovered_id = hover?.entity_id ?? null
  const target = fight && hovered_id ? fight.fighters.get(hovered_id) : null
  const target_ref = resolve_dungeon_ref(dungeon, hovered_id)
  if (!armed || !caster_id || !dungeon || !target?.cell || !target_ref) return EMPTY_PREDICTION

  // CASTABLE-NOW GATE, part 1 (turn ownership): a forecast is only legitimate while it's actually your move —
  // and this card is an AFFORDANCE, not a readout ("this cast kills it" is what a player acts on), so it must go
  // dark exactly when the board's own targeting wash does. `fight.input_armed` IS that boundary (#1808/#1993):
  // `turn_playable ⋀ !is_over` — chain seat ⋀ nothing replaying ⋀ the chain's mob-resolution budget spent. This
  // used to spell `active_entity_id === caster ⋀ winner === -1 ⋀ !presenting` — the PRE-#1808 boundary, a fourth
  // home of it, which forecasts a kill through the handover window while the range wash is already dark.
  // (The `busy` and `cast_presenting` halves of `wash_armed_spell` stay out: this module has never received the
  // run store's flight flag, and both belong to families that migrate on their own trains.)
  if (fight.input_armed !== true) return EMPTY_PREDICTION

  const me = dungeon.escrow?.find((p) => (p.character ?? p.character_id) === caster_id) ?? null
  const { template, spell_level, crit_rate, effects, ap_cost } = resolve_armed_spell(armed, me)
  if (!template) return EMPTY_PREDICTION
  // CASTABLE-NOW GATE, part 2 (affordability): the same AP check wash_armed_spell applies to the range highlight
  // — spent budget ⇒ no forecast, exactly like the board's blue ranges already clear.
  if ((fight.fighters.get(caster_id)?.ap ?? 0) < ap_cost) return EMPTY_PREDICTION

  // resolve_ref mirrors DungeonBoard.optimistic_cast (the board's live cast home), so the tooltip preview and
  // the real cast resolve refs IDENTICALLY. STATS need no adapter any more (#1077): every fighter's locked
  // snapshot rides the fight view itself, so both surfaces read the one block the authority resolves with.
  const resolve_ref = (id) => resolve_dungeon_ref(dungeon, id)
  // DETERMINISTIC CRIT (#163): a fight is seed-deterministic, so whether THIS pending cast crits is a FACT
  // computable pre-cast — never a chance. It lands on the NEXT turn-seed slot (my committed casts_this_turn + the
  // journal's own casts), the EXACT slot the DeckCluster socket glow previews. crit_clock_of (@aresrpg/fight) is
  // the ONE composer of that clock and next_slot_crit / socket_glows (deck-crit-glow.js → @aresrpg/sim) roll it,
  // so the tooltip, the glow and the cast that follows can never disagree and all mirror what the chain settles.
  // Seed-less / seat-less ⇒ null clock ⇒ the roll is unknown ⇒ the honest non-crit branch. (Past the turn gate.)
  const crit_clock = crit_clock_of({ fight: dungeon, seat_row: me, slot })
  const crit_slot = next_slot_crit(crit_clock)
  const is_crit = !!crit_slot && socket_glows(crit_slot.crit_roll, crit_rate)

  // engine_view fighter cells are DECODED {x,y}; predict_cast's target_cell is an ENCODED int (it decode()s it),
  // so encode here — passing the raw {x,y} decode()s to NaN → an off-board target → no Hit (the live-silence bug).
  const target_cell = encode(target.cell.x, target.cell.y)
  // #577 — the SAME resolved turn-seed slot that decides crit also rolls this cast's DAMAGE, so the previewed
  // number is exactly what the chain lands (not the range). `critical` stays the explicit resolved boolean; the
  // clock feeds only the damage roll. Seed-less / off-turn ⇒ crit_clock_of already answered null ⇒ an in-range
  // estimate (the honest unknown, mirroring the non-crit branch above). It is the composer's OWN clock, never a
  // second one assembled here: a hand-rebuilt copy silently went stale when the seed stopped folding the
  // wall-clock deadline, and fed the damage roll a clock with no entropy at all (`?? 0` → a fake seed).
  const critical_clock = crit_clock
  // Run the ONE damage home ONCE, on the RESOLVED branch — the exact number the chain lands, never a base+crit pair.
  return {
    prediction: predict_cast({ view: fight, caster_id, spell: template, spell_level, target_cell, critical: is_crit, critical_clock, resolve_ref }),
    is_crit,
    effects: effects.filter((fx) => !HEAD_OR_MOVE_KINDS.has(fx.kind)),
    target_ref,
  }
}
