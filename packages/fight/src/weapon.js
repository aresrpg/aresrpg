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

// ── §387 THE WEAPON SHAPE SYSTEM — the ONE HOME of the category → cell-set table (the client imports THIS; the
// Move engine carries a byte-identical twin in `participant.move::weapon_shape_of`). A weapon strike no longer
// resolves a single cell: it resolves the CATEGORY-SHAPED CELL SET around the aimed cell, oriented by the
// attacker→target axis (4-way, x wins ties — the board's push/displacement adjacency). The cell-set geometry is the
// existing spell `area_shape` machinery (`get_aoe_cells` / `combat_grid::zone_cells`), so the hover preview, the
// sim twin, and the chain all derive the SAME cells from one descriptor. Shapes key on the FINE category the
// equipped weapon carries; ranged classes additionally carry range attributes (see below).
import { SHAPE_LINE, SHAPE_NO_OVERRIDE, SHAPE_PODIUM, SHAPE_POINT, SHAPE_TBAR } from '@aresrpg/sim/spell_effect'

/**
 * @typedef {Object} WeaponShape
 * @property {number}  area_shape  the spell `area_shape` code the cell set derives from (POINT/LINE/TBAR/PODIUM)
 * @property {number}  area_size   the shape size fed to `get_aoe_cells` (0 = the single aimed cell)
 * @property {boolean} range_modifiable  ranged range benefits from the caster's `range` stat (bow); melee/fixed = false
 * @property {boolean} line_only   the aimed cell must sit on a straight cardinal line from the attacker (spellbook)
 */

// The DEFAULT shape — the single aimed cell, melee-fixed. Covers sword / dagger(s) / shovel / axe / pickaxe / every
// tool / bare hands / any unknown category (the exact pre-§387 behaviour). Only the NON-default categories are
// listed below, so an un-authored weapon can never resolve larger than it does today.
export const WEAPON_SHAPE_DEFAULT = /** @type {WeaponShape} */ ({
  area_shape: SHAPE_POINT,
  area_size: 0,
  range_modifiable: false,
  line_only: false,
})

// The total ruling (#387), keyed on the FINE category slug the weapon carries. `daggers` is the real family slug
// (the ruling's informal "dagger"); shovel/pickaxe are tools (weapon_family = none) and fall through to the default
// 1-cell above. scythe / hammer / wand are forward categories — listed now so they resolve the instant content
// authors them (the seed re-tune, #387 step ②).
export const WEAPON_SHAPES = /** @type {Record<string, WeaponShape>} */ ({
  // 2-INLINE — the aimed cell + the next cell along the strike direction.
  club: { area_shape: SHAPE_LINE, area_size: 1, range_modifiable: false, line_only: false },
  longsword: { area_shape: SHAPE_LINE, area_size: 1, range_modifiable: false, line_only: false },
  // 3-FRONT-ARC — the aimed cell + its two perpendicular neighbours (the TBAR bar of half-length 1).
  scythe: { area_shape: SHAPE_TBAR, area_size: 1, range_modifiable: false, line_only: false },
  staff: { area_shape: SHAPE_TBAR, area_size: 1, range_modifiable: false, line_only: false },
  spear: { area_shape: SHAPE_TBAR, area_size: 1, range_modifiable: false, line_only: false },
  // PODIUM-4 — the front arc + one cell beyond the aimed cell along the axis.
  battleaxe: { area_shape: SHAPE_PODIUM, area_size: 1, range_modifiable: false, line_only: false },
  mace: { area_shape: SHAPE_PODIUM, area_size: 1, range_modifiable: false, line_only: false },
  hammer: { area_shape: SHAPE_PODIUM, area_size: 1, range_modifiable: false, line_only: false },
  // RANGED 1-6 — single aimed cell at range; bow's range is MODIFIABLE (the `range` stat extends it), wand's is FIXED.
  bow: { area_shape: SHAPE_POINT, area_size: 0, range_modifiable: true, line_only: false },
  wand: { area_shape: SHAPE_POINT, area_size: 0, range_modifiable: false, line_only: false },
  // LINE 1-5 FIXED — single aimed cell, fixed range, but the aim must lie on a straight cardinal line.
  spellbook: { area_shape: SHAPE_POINT, area_size: 0, range_modifiable: false, line_only: true },
})

/** The shape descriptor for a weapon's FINE category (nullish / unknown / tool / bare hands ⇒ the 1-cell default). */
export const weapon_shape_of = (category) => (category != null && WEAPON_SHAPES[category]) || WEAPON_SHAPE_DEFAULT

/**
 * THE RESOLVED strike shape (twin of participant.move::weapon_shape_resolved, owner's merge-lives-once ruling): an
 * authored per-line shape OVERRIDE (`override.area_shape` when it is not SHAPE_NO_OVERRIDE) WINS over the category
 * table; otherwise `weapon_shape_of(category)` resolves it. range_modifiable / line_only ALWAYS come from the
 * category (an override tunes ONLY the cell-set shape + size). THE ONE HOME every strike consumer reads.
 * @param {{ area_shape?: number, area_size?: number }} [override]  the weapon's authored override (nullish ⇒ none)
 * @param {string|null|undefined} category
 * @returns {WeaponShape}
 */
export const weapon_shape_resolved = (override, category) => {
  const cat = weapon_shape_of(category)
  const shape = override?.area_shape
  if (shape != null && shape !== SHAPE_NO_OVERRIDE)
    return {
      area_shape: shape,
      area_size: Number(override.area_size ?? 0),
      range_modifiable: cat.range_modifiable,
      line_only: cat.line_only,
    }
  return cat
}
