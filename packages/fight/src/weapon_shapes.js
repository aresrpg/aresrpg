// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ╔══════════ [ #387 — THE WEAPON ZONE DOOR: category → the cell set one strike touches ] ══════════ ]
//
// A weapon strike used to touch exactly ONE cell, whatever was equipped. It now touches the ZONE its FINE
// category is assigned, and the zone is resolved by the SAME geometry engine every spell AoE already uses
// (`@aresrpg/sim/spell_targeting::get_aoe_cells`, whose chain twin is `combat_grid::zone_cells`). There is no
// second geometry implementation on either side of the twin: this module only decides WHICH `(area_shape,
// area_size)` descriptor a strike carries — the cells themselves are always the zone engine's answer.
//
// TWO LAYERS, deliberately separate, because they have different owners:
//
//   ZONE KINDS (below, code-owned)  — a named zone ⇒ the spell-engine descriptor that draws it. Five kinds, the
//     content house's sealed vocabulary. Geometry is a MECHANIC: renaming or re-drawing a kind is a code change
//     with a twin commit and a parity fixture, never a data edit.
//
//   CATEGORY ASSIGNMENTS (below, DATA)  — which category strikes which zone, plus the ranged band. These are
//     authored CONTENT and arrive as published chain/catalog state; the table here is the BUILT-IN DEFAULT the
//     engine falls back to before/without published data, pinned to the #387 ruling. Published data overrides
//     it per template, so a rebalance never needs an engine release.
//
// ── THE EXPECTED PUBLISHED-DATA SHAPE (the seed authors this; the engine only reads it) ──────────────────────
//
// Per weapon TEMPLATE, the catalog row carries:
//
//   {
//     category: 'staff',            // the FINE category slug — the assignment key (NOT the coarse family)
//     zone: 'line_perp_3',          // one of the five ZONE_KINDS names below; absent ⇒ 'single'
//     range: { min: 2, modifiable: true },  // the band FLOOR + whether the caster's range stat extends it. The
//                                           // band CEILING is the template's own authored reach, never restated
//                                           // here — one home for the number the chain already carries.
//     line_only: false,             // true ⇒ the aimed cell must sit on a straight line from the attacker
//   }
//
// On chain the same two facts arrive by two doors, both already published-gated:
//   · the strike's category rides the seat's `Weapon` (`participant.move` — `weapon_category`), snapshotted at
//     fight entry from the equipped item, so the chain never trusts a PTB-supplied zone;
//   · a per-template OVERRIDE rides each authored `WeaponLine` as `(area_shape, area_size)` with the sentinel
//     `spell_effect::shape_no_override()` (255) meaning "no override, use the category assignment". An authored
//     line therefore outranks the category table — that is the fine-grained authoring door for one-off items.
//
// Resolution order, one home, both twins: authored line override → category assignment → `single`.

import { SHAPE_CROSS, SHAPE_LINE, SHAPE_POINT, SHAPE_PODIUM, SHAPE_TBAR } from '@aresrpg/sim/spell_effect'

/** The sentinel an authored `WeaponLine.area_shape` carries when it holds NO zone override (Move:
 *  `spell_effect::shape_no_override()`). 255, not 0 — `SHAPE_POINT` is a legitimate single-cell override. */
export const SHAPE_NO_OVERRIDE = 255

/**
 * @typedef {Object} WeaponZone
 * @property {number} area_shape  the spell zone code the cell set derives from
 * @property {number} area_size   the zone size handed to the zone engine (0 = the aimed cell alone)
 */

/**
 * The five ZONE KINDS, by the content house's sealed names. Each is a descriptor for the EXISTING spell zone
 * engine — the cells are drawn by `get_aoe_cells` / `zone_cells`, never here.
 *
 *   single         the aimed cell alone (1 cell) — the pre-#387 behaviour, and the default for anything unlisted
 *   line_inline_2  the aimed cell + the next cell along the strike axis (2 cells, a thrust through the target)
 *   line_perp_3    the aimed cell + one cell each side, perpendicular to the strike axis (3 cells, a sweep)
 *   cross_1        the radius-1 diamond cross around the aimed cell (5 cells, incl. the attacker's own side)
 *   podium_4       `line_perp_3` + one cell beyond the aimed cell along the axis (4 cells, a heavy overhead)
 *
 * @type {Record<string, WeaponZone>}
 */
export const ZONE_KINDS = {
  single: { area_shape: SHAPE_POINT, area_size: 0 },
  line_inline_2: { area_shape: SHAPE_LINE, area_size: 1 },
  line_perp_3: { area_shape: SHAPE_TBAR, area_size: 1 },
  cross_1: { area_shape: SHAPE_CROSS, area_size: 1 },
  podium_4: { area_shape: SHAPE_PODIUM, area_size: 1 },
}

/** The `single` descriptor, named once: the fallback for every unknown category, tool, and bare hands. It can
 *  never resolve wider than a pre-#387 strike, so an un-authored weapon is never silently buffed. */
export const ZONE_SINGLE = ZONE_KINDS.single

/**
 * @typedef {Object} CategoryStrike
 * @property {string}  zone              a `ZONE_KINDS` name
 * @property {number}  [range_min]       the band floor (absent ⇒ 1)
 * @property {boolean} [range_modifiable] the caster's range stat extends the band (bow)
 * @property {boolean} [line_only]       the aimed cell must lie on a straight line from the attacker
 */

/**
 * The BUILT-IN DEFAULT category → strike assignment (#387 ruling). DATA, keyed by the FINE category slug — the
 * resolver below contains zero category names, and published catalog data overrides any row of this table.
 * Categories absent here (every tool, bare hands, anything content adds later) resolve `single`.
 * @type {Record<string, CategoryStrike>}
 */
export const CATEGORY_STRIKES = {
  // 1 CELL — the aimed cell alone.
  sword: { zone: 'single' },
  dagger: { zone: 'single' },
  daggers: { zone: 'single' }, // the engine's own family slug for the ruling's "dagger"
  shovel: { zone: 'single' },
  axe: { zone: 'single' },
  pickaxe: { zone: 'single' },
  // 2 CELLS INLINE — the aimed cell + the cell beyond it.
  club: { zone: 'line_inline_2' },
  longsword: { zone: 'line_inline_2' },
  // 3 CELLS, THE FRONT ARC — the aimed cell + its two perpendicular neighbours.
  scythe: { zone: 'line_perp_3' },
  staff: { zone: 'line_perp_3' },
  spear: { zone: 'line_perp_3' },
  // 4 CELLS, THE PODIUM — the front arc + one cell beyond the aimed cell.
  battleaxe: { zone: 'podium_4' },
  mace: { zone: 'podium_4' },
  hammer: { zone: 'podium_4' },
  // RANGED — a single aimed cell at a band. The bow's band grows with the caster's range stat; the wand's does
  // not; the spellbook's is fixed AND must be aimed along a straight line.
  bow: { zone: 'single', range_min: 1, range_modifiable: true },
  wand: { zone: 'single', range_min: 1, range_modifiable: false },
  spellbook: { zone: 'single', range_min: 1, line_only: true },
}

/** The `CategoryStrike` for a FINE category slug — nullish / unknown / tool / bare hands ⇒ plain `single`.
 *  @param {string | null | undefined} category @returns {CategoryStrike} */
export const category_strike_of = (category) =>
  (category != null && CATEGORY_STRIKES[String(category)]) || { zone: 'single' }

/** A zone NAME → its engine descriptor; an unknown name degrades to `single` rather than throwing, so a
 *  catalog row published ahead of an engine release can never brick a strike. @param {string} zone */
export const zone_descriptor_of = (zone) => ZONE_KINDS[String(zone)] ?? ZONE_SINGLE

/**
 * The zone a STRIKE resolves, applying the whole resolution order: an authored line override outranks the
 * category assignment, which outranks `single`. `lines` are the seat's authored `WeaponLine` rows as the board
 * normalizes them; the FIRST line carrying an override wins (a weapon has one strike, so it has one zone —
 * multiple overriding lines are a content error, and taking the first keeps both twins' answer identical).
 * @param {{ category?: string | null, lines?: { area_shape?: number, area_size?: number }[] } | null} weapon
 * @returns {WeaponZone}
 */
export const weapon_strike_zone = (weapon) => {
  const override = (weapon?.lines ?? []).find(
    (line) => line?.area_shape != null && Number(line.area_shape) !== SHAPE_NO_OVERRIDE
  )
  if (override) return { area_shape: Number(override.area_shape), area_size: Number(override.area_size ?? 0) }
  return zone_descriptor_of(category_strike_of(weapon?.category).zone)
}

/**
 * The strike's RANGE BAND `[min, max]` and whether the caster's range stat extends it. Ranged categories carry
 * an authored band; everything else strikes from its own `reach` at min 1 (a melee swing), exactly as before.
 * @param {{ category?: string | null, reach?: number } | null} weapon
 * @returns {{ range: [number, number], modifiable: boolean, line_only: boolean }}
 */
export const weapon_strike_range = (weapon) => {
  const strike = category_strike_of(weapon?.category)
  const reach = Math.max(1, Number(weapon?.reach ?? 1))
  return {
    // The band CEILING is the weapon's own authored `reach` — chain truth, one home, identical on both twins.
    // The category contributes the floor, whether the range stat extends it, and whether the aim must be linear.
    range: [Math.max(0, Number(strike.range_min ?? 1)), reach],
    modifiable: Boolean(strike.range_modifiable),
    line_only: Boolean(strike.line_only),
  }
}
