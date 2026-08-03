// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// End-fight card row NAME resolution — a post-fight `/v1` read applied to fight-summary rows.
//
// HISTORY, and why this file no longer owns a fallback. The projection used to bake a fighter's `name` as
// `row.name || roster_name || \`${addr.slice(0,6)}…${addr.slice(-4)}\``, so a fight that ended before the
// mid-fight roster resolve landed carried a raw OWNER-ADDRESS slice into `summary.participants[].name`. This
// module answered by inventing its OWN substitute — `short_fighter_id(row.id)`, a CHARACTER-ID slice — which
// fixed the address but created the real defect (#1865 class): the live board and this card rendered the same
// unresolvable fighter under two different names at the same instant.
//
// #1993 WP3 removed the cause instead. The roster identity book resolves identity ONCE and an unresolved row
// carries its id, so `row.name` arriving here is already the book's one honest label and there is nothing left
// to correct. What survives is the genuinely useful half: a FRESH post-fight `/v1` read, taken with no
// turn-clock pressure, that can UPGRADE an id to a real name the live fight never got to see. When it resolves
// nothing, the carried label stands — this module invents no string of its own.

import { short_id } from '@aresrpg/fight/project'

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
 * through UNCHANGED (never touched — see resolvable_row_ids). Any other player row takes the freshly resolved
 * name as an UPGRADE. Absent that, the row's OWN `resolved` flag decides, because the identity book already
 * decided it: a resolved row keeps its authored label, an unresolved one shows its id. No substitute is invented
 * here and no string is second-guessed — a name that survived the book is a real name.
 *
 * `short_id(row.id)` is not a second truncation: a player fighter's entity id IS its character id
 * (`participant_entity_id`), so this is the same `display_id` the book computed, re-derived from the id the row
 * already carries rather than snapshotted twice. It also scrubs a PRE-#1993 persisted summary, whose rows have no
 * `resolved` field and may still carry the old owner-address slice baked upstream — unresolved by default.
 * @template {{ id?: string, name?: string, label?: string, resolved?: boolean, is_player?: boolean, is_me?: boolean }} Row
 * @param {Row[] | null | undefined} rows
 * @param {Map<string, { name?: string }>} character_docs
 * @returns {Row[]}
 */
export function apply_resolved_names(rows, character_docs) {
  return (rows ?? []).map((row) => {
    if (!row?.is_player || row.is_me) return row
    const resolved_name = character_docs.get(row.id)?.name
    const carried = row.resolved ? (row.label ?? row.name) : short_id(row.id)
    return { ...row, name: resolved_name || carried }
  })
}
