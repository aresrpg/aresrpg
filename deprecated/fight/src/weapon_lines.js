// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ╔══════ [ §17.27 — THE WEAPON FAMILY LINE: an equipped family → the attack line it swings ] ══════ ]
//
// The client twin of `participant.move`'s `weapon_line_of` / `unarmed_line`. On a CHAIN-backed fight the seat's
// `Weapon` is built at fight entry and rides the escrow row, so nothing here runs; a chain-LESS fight (the build
// simulator) has no such door and must resolve the same line itself, or every seat fights bare-handed whatever it
// equipped (#1803). One function, one table, so the simulator and the chain can never swing different weapons.
//
// The numbers are the §17.27 v1 tuning band and they live TWICE by necessity (a Move const table cannot be read
// from JS). `packages/sim/test/fixtures/weapon_family_lines.json` is the shared expectation both twins assert
// against — `packages/fight/test/weapon_family_lines.test.js` reads this module, and
// `packages/move/engine/tests/weapon_line_table_tests.move` reads the Move table, off the one file.

/** The weapon families (`participant.move` WL_FAMILIES, same order — the first 11 are also `equipment.move`
 *  WEAPON_FAMILIES, the equippable class weapons). A weapon-slot item whose category is NOT one of these is a
 *  gathering tool: it fights bare-handed. */
export const WEAPON_FAMILIES = [
  'longsword',
  'daggers',
  'battleaxe',
  'spear',
  'staff',
  'spellbook',
  'bow',
  'axe',
  'mace',
  'club',
  'sword',
  // #387 — the five that carried a strike zone but no line, so they fought bare-handed.
  'wand',
  'hammer',
  'scythe',
  'shovel',
  'pickaxe',
]

// Index-aligned with WEAPON_FAMILIES, verbatim from participant.move's WL_* tables.
const WL_ELEMENT = [2, 3, 2, 2, 0, 1, 3, 0, 2, 2, 2, 1, 2, 3, 2, 0] // 0 fire · 1 water · 2 earth · 3 air
const WL_DAMAGE = [18, 10, 22, 14, 12, 10, 15, 20, 17, 16, 15, 11, 21, 19, 14, 16]
const WL_CRIT_DAMAGE = [27, 16, 33, 21, 18, 15, 22, 30, 25, 24, 22, 16, 31, 28, 21, 24]
const WL_CRIT_RATE = [20, 10, 25, 20, 20, 20, 20, 22, 20, 18, 18, 20, 22, 20, 20, 25] // 1-in-X
const WL_AP_COST = [4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 4, 4]
const WL_REACH = [1, 1, 1, 2, 3, 5, 6, 1, 1, 1, 1, 2, 1, 1, 1, 1] // Manhattan

/** Bare hands (`participant.move unarmed_line`): earth, low fixed damage, cheap swings, melee reach. A family
 *  line is FIXED (max == min), so both maxima mirror their floors — the #577 roller has nothing to roll. */
export const UNARMED_WEAPON = {
  element: 2,
  damage: 4,
  damage_max: 4,
  crit_damage: 6,
  crit_damage_max: 6,
  crit_rate: 30,
  ap_cost: 3,
  reach: 1,
}

/** +10% own-class affinity (DECISIONS 07-12) on a damage base, integer-floored — damage bases ONLY, never
 *  crit_rate / ap_cost / reach (mechanics, not damage). */
const affinity_scale = (base, affinity) => (affinity ? Math.floor((base * 110) / 100) : base)

/**
 * The attack line for an equipped weapon FAMILY. A blank/unknown slug — a gathering tool in the weapon slot, or
 * no weapon at all — fights BARE-HANDED, never an error: a miner ambushed mid-gather still gets a fight (§7).
 * Bare hands carry no affinity (an unarmed hit has no class).
 * @param {string | null | undefined} family the equipped item's FINE category slug
 * @param {boolean} [affinity] the family IS the wielder's own class family
 * @returns {{ element: number, damage: number, damage_max: number, crit_damage: number,
 *   crit_damage_max: number, crit_rate: number, ap_cost: number, reach: number, category: string }}
 */
export const weapon_line_of = (family, affinity = false) => {
  const index = WEAPON_FAMILIES.indexOf(String(family ?? ''))
  if (index < 0) return { ...UNARMED_WEAPON, category: '' }
  const damage = affinity_scale(WL_DAMAGE[index], affinity)
  const crit_damage = affinity_scale(WL_CRIT_DAMAGE[index], affinity)
  return {
    element: WL_ELEMENT[index],
    damage,
    damage_max: damage,
    crit_damage,
    crit_damage_max: crit_damage,
    crit_rate: WL_CRIT_RATE[index],
    ap_cost: WL_AP_COST[index],
    reach: WL_REACH[index],
    // §387 — the matched FINE family IS the zone key the strike's cell set resolves from.
    category: WEAPON_FAMILIES[index],
  }
}
