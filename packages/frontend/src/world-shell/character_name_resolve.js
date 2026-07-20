// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE HOME for "character id → display name" resolution off the /v1 read layer (07-19: raw
// addresses were leaking onto the fights-in-range modal AND the live fight-HUD turn order — two surfaces,
// two ad hoc resolutions, one bug class). rpc/client's get_characters is the ONE fetch home (its own LRU
// absorbs repeat calls — no second cache here); this is the ONE shaping home on top of it, so
// every fighter-name surface falls back to the exact same truncated id, never a bespoke one per component.
// Consumers: FightsModal (party/enemy hover card) and fight.js's ensure_roster (ctx.roster — the live fight
// HUD's turn-order names, ONE HOME per project.js's engine_view: `roster.find(c => c.id === character_id)`).

import { get_characters } from '../rpc/client'

/** Short identity fallback for a Character id whose `/v1/characters?ids=` row is still unavailable — the ONLY
 *  honest display when a real name genuinely can't be resolved (never invent one). */
export function short_fighter_id(id) {
  const value = String(id ?? '')
  if (value.length <= 14) return value
  return `${value.slice(0, 7)}…${value.slice(-5)}`
}

/**
 * Resolve a batch of character ids to their `/v1/characters` docs in ONE read. Empty/no ids → an empty Map,
 * no request. `fetch_characters` is a pure-injection test seam (defaults to the real rpc/client fetcher) —
 * keeps this unit-testable without bun:test's process-global `mock.module`.
 * @param {(string|null|undefined)[]} ids
 * @param {(query:{ids:string[]})=>Promise<any[]>} [fetch_characters]
 * @returns {Promise<Map<string, any>>}
 */
export async function resolve_character_docs(ids, fetch_characters = get_characters) {
  const unique = [...new Set((ids ?? []).filter(Boolean))]
  if (unique.length === 0) return new Map()
  const characters = await fetch_characters({ ids: unique }).catch(() => [])
  return new Map((characters ?? []).map((character) => [character.id, character]))
}

/**
 * Player-fighter character ids a live fight's ctx.roster still needs a doc for (07-19: a party member's
 * fighter row showed a raw truncated address — fight.js's roster ctx used to carry ONLY `sui.characters`, my
 * own alts, so project.js's `roster.find(c => c.id === character_id)` never matched a co-fighter). Mobs
 * (`is_player` false) never enter the request; an id already in `mine` or already resolved/pending is never
 * re-requested. Pure — no IO, unit-tested without booting the fight core.
 * @param {Map<string, { is_player?: boolean, character_id?: string|null }> | undefined} fighters
 * @param {{ id?: string }[]} mine
 * @param {{ has: (id: string) => boolean }} already_known ids already resolved OR already in flight (a Set or a
 *   Map — anything key-checkable; fight.js passes a Map so it can also hold each id's resolved doc)
 * @returns {string[]}
 */
export function missing_roster_character_ids(fighters, mine, already_known) {
  const mine_ids = new Set((mine ?? []).map((c) => c?.id).filter(Boolean))
  const seen = new Set()
  const missing = []
  for (const f of fighters?.values?.() ?? []) {
    const character_id = f?.is_player ? f.character_id : null
    if (!character_id || mine_ids.has(character_id) || already_known.has(character_id) || seen.has(character_id))
      continue
    seen.add(character_id)
    missing.push(character_id)
  }
  return missing
}
