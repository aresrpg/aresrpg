// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/weapon.js — the equipped-WEAPON basic-attack sentinel (S-25) and its pre-read fallbacks, moved into
// the fight core from core/modules/fight.js (2026-07-17): the sentinel is fight-session vocabulary (it arms
// through the SAME armed_spell_id machinery every spell uses), and living here lets leaf consumers
// (fight-sfx, folds, the adapter) import it without touching the game-core module graph — the fight-sfx →
// modules/fight.js edge was a dependency cycle's entry. modules/fight.js re-exports these verbatim, so every
// existing import keeps working.

// The HAND / equipped-WEAPON basic attack occupies numkey slot 0 in the spell bar (S-25). It has NO seed
// row (it is not a spell), so it arms via this sentinel id through the SAME armed_spell_id machinery every
// spell uses (arm/disarm toggle, turn-flip clear, Escape) — one selection SSOT, no parallel state. Readers
// that resolve a seed row from armed_spell_id (DungeonSpellReadout, seed_range_of) return their safe empty
// default for it; the board special-cases it to paint a melee targeting ring and route the click to the
// documented S-12 §17.27 cast-dispatch seam. Double-underscore-prefixed so it can never collide with a
// seed name_key (all lower-snake words).
export const WEAPON_ATTACK_ID = '__weapon_attack'

// S-12 §17.27 — the PRE-READ FALLBACK for the weapon/hand basic attack. The LIVE range/AP come from the seat's
// on-chain Weapon (participant.move — reach/ap_cost, surfaced on the escrow row and read by DungeonBoard's
// cast_params); these constants only shape the melee ring for the split second before the escrow read lands.
// AP 0 = never gate on cost pre-read (the chain validates the real ap_cost); reach 1 = the unarmed melee floor.
export const WEAPON_ATTACK_RANGE = /** @type {[number, number]} */ ([1, 1])
export const WEAPON_ATTACK_AP = 0

// ╔════════ [ The strike's DAMAGE — the client twin of cast.move's weapon_damage_total (#1323) ] ════════ ]
//
// The chain resolves a weapon strike from the seat's AUTHORED item lines and falls back to the participant's
// single family `Weapon` only when it has none:
//
//   lines.is_empty() ⇒ one row from the `Weapon`'s own element + band   (bare hands, un-authored weapons)
//   otherwise        ⇒ one row PER line, each keyed to its OWN element  (§17.27 wave-2a)
//
// Per-line is mechanical, not cosmetic: each row meets the target's own per-element resist (fire vs fire
// resist, water vs water), exactly as a multi-element spell applies, and ONE per-strike roll is mapped onto
// every row's band. Before this existed the client had no concept of lines at all, so a seat wearing an
// authored weapon was previewed at its weapon-FAMILY constant while the chain settled Σ(lines) — different
// numbers by construction, on every surface that prices a strike.
//
// THE ONE HOME. `predict_cast.weapon_spell_template` (the hover card + the board's optimistic cast) and the
// spell bar's socket tooltip both derive from the rows below, so no surface can price a strike its own way.

import { roll_in_range, slot_damage_roll, turn_seed } from '@aresrpg/sim/turn_seed'

/**
 * The strike's damage ROWS at one branch — `[{ element, min, max }]`, the authored bands before any stat
 * amplification or resistance. Lines when the seat has them, the family `Weapon` otherwise; `critical` swaps
 * every row to its crit band exactly as the chain's one crit boolean does.
 * @param {any} weapon a normalized escrow weapon (board_state.normalize_weapon)
 * @param {boolean} critical
 * @returns {{ element: number, min: number, max: number }[]}
 */
export const weapon_damage_rows = (weapon, critical) => {
  const row = (element, min, max) => ({
    element: Number(element ?? 255),
    min: Number(min ?? 0),
    // Absent max ⇒ its own floor, which IS the fixed line (`new_weapon_line`'s alias sets `damage_max: damage`
    // on chain) — one degradation path, never a second shape.
    max: Number(max ?? min ?? 0),
  })
  const lines = Array.isArray(weapon?.lines) ? weapon.lines : []
  if (lines.length)
    return lines.map((line) =>
      critical
        ? row(line.element, line.crit_damage ?? line.damage, line.crit_damage_max ?? line.crit_damage ?? line.damage)
        : row(line.element, line.damage, line.damage_max ?? line.damage)
    )
  const w = weapon ?? {}
  return [
    critical
      ? row(w.element, w.crit_damage ?? w.damage, w.crit_damage_max ?? w.crit_damage ?? w.damage)
      : row(w.element, w.damage, w.damage_max ?? w.damage),
  ]
}

/**
 * The strike's TOTAL authored band `{ min, max }` — Σ over the rows, pre-resist. What a socket/tooltip states
 * when it has no slot to roll: an honest envelope, never one end of it presented as the number.
 * @param {any} weapon @param {boolean} [critical]
 */
export const weapon_strike_band = (weapon, critical = false) =>
  weapon_damage_rows(weapon, critical).reduce((band, r) => ({ min: band.min + r.min, max: band.max + r.max }), {
    min: 0,
    max: 0,
  })

/** The distinct elements a strike deals in row order — one for a family line, N for an authored multi-element
 *  weapon. Display only; the resolution itself is per row. @param {any} weapon @returns {number[]} */
export const weapon_strike_elements = (weapon) => [...new Set(weapon_damage_rows(weapon, false).map((r) => r.element))]

/**
 * The §7 SLOT-EXACT next strike: the same per-strike `damage_roll` mapped onto every row's band and summed —
 * `cast.move`'s `weapon_effect_value` verbatim, and deliberately element-neutral/pre-resistance like it (the
 * bar has no target). Null without a resolvable slot (off-turn, pre-read): the roll is genuinely unknown then,
 * and the band above is the honest thing to show instead of a fabricated number.
 * @param {{ world_seed:any, spawn_id:any, turn_deadline_ms:any, seat:number, slot:number } | null} clock
 * @param {any} weapon @param {boolean} [critical]
 * @returns {number | null}
 */
export const weapon_next_hit = (weapon, clock, critical = false) => {
  if (!clock || clock.slot == null || !(clock.slot >= 0)) return null
  const roll = slot_damage_roll(turn_seed(clock), clock.slot)
  return weapon_damage_rows(weapon, critical).reduce((total, r) => total + roll_in_range(r.min, r.max, roll), 0)
}
