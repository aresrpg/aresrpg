// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-fight card row NAME resolution — the ONE HOME (character_name_resolve.js) applied to fight-summary rows.
// ROOT CAUSE (a party row showed "0xDEE0…AD38"): packages/fight/src/project.js:321 bakes a fighter's
// `name` as `row.name || roster_name || \`${addr.slice(0,6)}…${addr.slice(-4)}\`` — whenever the live mid-fight
// ctx.roster resolve (fight.js ensure_roster) hasn't landed by the time the fight ends, the SNAPSHOT
// fight_recap.js takes carries that raw slice verbatim into `summary.participants[].name`. This mirrors the
// 07-19 fix already proven on the live fight-HUD roster (missing_roster_character_ids/ensure_roster) but
// applies it to the END-OF-FIGHT CARD instead: a FRESH /v1 read, taken post-fight with no turn-clock pressure,
// so the raw/differently-shaped slice never survives to render here either — belt-and-suspenders independent
// of whether the mid-fight resolve completed in time.

import { short_fighter_id } from '../../../world-shell/character_name_resolve.js'

/**
 * Row ids worth a batched character-doc lookup: PLAYER rows (never a mob/content row — its name is real game
 * content, not a chain identity) excluding the local player (already correct + synchronous off `sui.characters`
 * — no need to round-trip a read for yourself, and skipping avoids a needless flash before the batch resolves).
 * Deduplicated, falsy ids dropped.
 * @param {Array<{ id?: string, is_player?: boolean, is_me?: boolean } | null | undefined>} rows
 * @returns {string[]}
 */
export function resolvable_row_ids(rows) {
  const ids = (rows ?? []).filter((row) => row?.is_player && !row?.is_me).map((row) => row.id)
  return [...new Set(ids.filter(Boolean))]
}

/**
 * Merge resolved character docs onto fighter rows. A mob/content row or the local player's own row passes
 * through UNCHANGED (never touched — see resolvable_row_ids). Any other player row prefers the freshly
 * resolved name; absent that (lookup still in flight, or a genuinely gone character) it renders the ONE
 * short-id fallback — never the raw address, never the differently-truncated slice baked upstream.
 * @template {{ id?: string, name?: string, is_player?: boolean, is_me?: boolean }} Row
 * @param {Row[] | null | undefined} rows
 * @param {Map<string, { name?: string }>} character_docs
 * @returns {Row[]}
 */
export function apply_resolved_names(rows, character_docs) {
  return (rows ?? []).map((row) => {
    if (!row?.is_player || row.is_me) return row
    const resolved_name = character_docs.get(row.id)?.name
    return { ...row, name: resolved_name || short_fighter_id(row.id) }
  })
}
