// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NO QUALITY TIERS:
// this module was the SSOT for quality -> colour/tint/order across every HUD surface. It stays as
// the single seam every consumer imports, but every quality now resolves to the SAME neutral steel
// tone and a flat sort rank, so no surface can reveal a tier. The module (and the `quality` field it
// reads) dies entirely with the seed-data purge ticket — do NOT re-introduce per-tier values here.

/** @typedef {'junk'|'common'|'uncommon'|'rare'|'epic'|'legendary'|'developer'} Quality */

const NEUTRAL = '#a9b4c4'

/** quality -> hex name/edge tint. Tier-blind: one tone for all. */
export const QUALITY_COLOR = /** @type {const} */ ({
  junk: NEUTRAL,
  common: NEUTRAL,
  uncommon: NEUTRAL,
  rare: NEUTRAL,
  epic: NEUTRAL,
  legendary: NEUTRAL,
  developer: NEUTRAL,
})

/** quality -> sort rank. Tier-blind: flat, so sorts fall through to their secondary keys. */
export const QUALITY_ORDER = /** @type {const} */ ({
  junk: 1,
  common: 1,
  uncommon: 1,
  rare: 1,
  epic: 1,
  legendary: 1,
  developer: 1,
})

/** @param {string | null | undefined} q @returns {string} */
export const quality_color = q =>
  QUALITY_COLOR[/** @type {keyof typeof QUALITY_COLOR} */ (q)] ??
  QUALITY_COLOR.common

/** @param {string | null | undefined} q @returns {number} */
export const quality_order = q =>
  QUALITY_ORDER[/** @type {keyof typeof QUALITY_ORDER} */ (q)] ?? 1

/** Tier-blind: no legendary treatment either (the animated border glow died with the tiers). */
export const is_legendary = () => false

/** quality -> the resting cell/panel tint. Tier-blind: the same faint neutral radial for every item.
 * @param {string | null | undefined} _q @returns {string} */
export const rarity_tint = _q =>
  `radial-gradient(135% 100% at 50% 0%, ${NEUTRAL}16 0%, ${NEUTRAL}08 50%, transparent 100%)`
