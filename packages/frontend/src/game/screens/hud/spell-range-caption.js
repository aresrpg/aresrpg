// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE home for what a spell's authored range says about its own modifiability. On-chain a SpellLevel
// carries `modifiable_range` (spell_effect.move) — the +range stat extends a true one and is inert on a
// false one — so a range printed WITHOUT that verdict is a half-truth: a player reading "1–3" cannot tell a
// fixed range from a UI that forgot to mention the boost. Every surface that prints a range prints this
// caption beside it (encyclopedia spell page, grimoire detail, fight hover card), so silence never has to be
// interpreted.

/**
 * PURE: a projected spell level → the i18n key of the caption its range must carry.
 * Self-cast (0–0) leads, because "the +range stat does/doesn't extend this" says nothing about a spell that
 * only ever lands on the caster.
 * @param {{ range?: number[], modifiable_range?: boolean } | null | undefined} level
 * @returns {'spells.range_self_cast' | 'spells.range_extendable' | 'spells.range_fixed'}
 */
export const spell_range_caption_key = (level) => {
  const range = Array.isArray(level?.range) ? level.range : []
  if (Number(range[0]) === 0 && Number(range[1]) === 0) return 'spells.range_self_cast'
  return level?.modifiable_range === true ? 'spells.range_extendable' : 'spells.range_fixed'
}
