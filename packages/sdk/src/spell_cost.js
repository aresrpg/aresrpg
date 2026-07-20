// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Reference-corpus stamina-cost -> turn-based AP-cost conversion. THE single source of truth for the spell
// cost scale, shared by the content seed (scripts/seed-content.js) and any regeneration of spells.json.
//
// WHY this exists
// ----------------
// AresRPG's combat is grid + AP/MP (base AP = 6, base MP = 3 — see src/stats.js get_base_stat). The
// donor reference-corpus data is real-time/3D: a spell's gating number is its `levelsJson.stamina_cost`, which
// ranges over [0, 300] and clusters at 30/40/50/60/80/120/150/200/300. Copying stamina verbatim into
// the AP `cost` field (the original seed did `cost: lvl.stamina_cost ?? 0`) left every signature spell
// costing 30-300 AP against a 6-AP turn budget, so 10 of the 12 classes had NO castable spell at level 1
// (only senshi/yajin had hand-authored low-AP basics). This formula lands the stamina scale inside the
// AP budget so EVERY class has at least one castable spell.
//
// THE FORMULA (faithful, not hand-picked numbers)
// -----------------------------------------------
//   ap_cost = clamp(round(stamina / AP_PER_STAMINA), AP_MIN, AP_MAX)
//
//   AP_PER_STAMINA = 20   the divisor that maps the dense 30-80 stamina cluster (each class's cheap
//                         kit) into the castable 2-4 AP band while pushing the 120-300 ultimates to the
//                         6-AP ceiling. Derived from the observed distribution + the base 6-AP budget:
//                         the cheapest real spell (30 stamina) -> 2 AP leaves room to also move (MP) and
//                         the heaviest (>=110 stamina) -> 6 AP costs a whole turn. NOT per-spell tuning;
//                         one divisor applied uniformly.
//   AP_MIN = 1            no free spells — a 0-stamina utility (iyashi word_of_altruism) still costs 1 AP
//                         (the brief: "costs are positive integers within range").
//   AP_MAX = 6            the base AP budget (stats.js) — the cap that GUARANTEES castability: any spell
//                         is affordable in a single full turn, so every class clears the <=6 bar.
//
// Movement / reposition spells (donor effect set is empty or pure-utility, e.g. tokei `blink`) naturally
// land at the floor of the band (1-2 AP) because their stamina is low — they read as a cheap MP-like
// utility within the budget. We intentionally do NOT mint a separate spell `mp_cost` field: the sim only
// ever spends MP on path length (fight_actions.js), and adding an unconsumed cost lever would be dead
// code. The MP base (3) is the movement budget the cheap utilities share a turn with, not a second tax.

/** The base action-point budget (mirror of stats.js get_base_stat ACTION). The conversion cap. */
export const AP_MAX = 6

/** No free spells: every cast costs at least one AP. */
export const AP_MIN = 1

/**
 * Stamina-per-AP divisor. The dense 30-80 stamina kit -> 2-4 AP; the 120-300 ultimates -> the 6-AP cap.
 * One uniform divisor (no per-spell magic numbers) — change THIS to retune the whole game's cost scale.
 */
export const AP_PER_STAMINA = 20

/**
 * Convert a reference-corpus `stamina_cost` into a turn-based AP cost.
 * Pure + deterministic (integer out): same stamina -> same AP. No floats leak (round + clamp).
 *
 * @param {number | undefined | null} stamina  the donor levelsJson stamina_cost
 * @returns {number} AP cost, a positive integer in [AP_MIN, AP_MAX]
 */
export const stamina_to_ap = stamina => {
  const raw =
    typeof stamina === 'number' && Number.isFinite(stamina) ? stamina : 0
  const scaled = Math.round(raw / AP_PER_STAMINA)
  return Math.max(AP_MIN, Math.min(AP_MAX, scaled))
}
