// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE shaping home for character display names and fight-roster composition. `/v1` consumers share the
// batched resolver; the live fight adopter supplies its full normalized custody/display rows to this composition
// so names and appearance cannot diverge. Every unresolved surface uses the same short-id fallback.

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
 * THE FIGHT'S NAME BOOK (#929) — one `ctx.roster` row per PLAYER FIGHTER, keyed by its CHARACTER id, so
 * `engine_view`'s `roster.find(c => c.id === character_id)` always matches and its last-ditch OWNER-ADDRESS
 * fallback can never surface. That fallback is what both halves of #929 rendered: a coop remote showed the
 * joiner's wallet, and every simulator seat showed the sim chain's ONE mock owner (`0X51M0…0000`) because the
 * seats share it — an address is not an identity when a wallet owns several characters.
 *
 * Four sources, lowest precedence first — later rows win per id, so a real name always beats a placeholder:
 *   · PROVISIONAL — every player fighter with no row yet, named by its own short CHARACTER id (the honest
 *     in-flight display #929 explicitly accepts, never an invented name and never someone's address).
 *   · CARRIED — the rows already published for THIS fight. The book only grows within a fight, which is what
 *     lets a non-`/v1` seeder (the simulator shim seeds its roster into ctx at start) keep its real names
 *     instead of being wiped by the next recompose — the dual-writer clobber that made #929 fire on EVERY
 *     sim player row even after the seats were named.
 *   · RESOLVED — normalized custody/display rows. A coop remote's name, class, sex and colors land through
 *     read_character, the same full appearance home as the owned avatar; there is no second partial fetch.
 *   · MINE — my own kiosk characters, always the freshest truth about my own seats.
 *
 * Pure: no IO, no store read. @param {{ mine?: readonly any[], resolved?: readonly any[],
 *   carried?: readonly any[], fighters?: Map<string, any> | undefined }} sources
 * @returns {any[]} the composed roster rows
 */
export function compose_fight_roster({ mine = [], resolved = [], carried = [], fighters = undefined } = {}) {
  const by_id = new Map()
  for (const fighter of fighters?.values?.() ?? []) {
    if (!fighter?.is_player || !fighter.character_id) continue
    const id = String(fighter.character_id)
    by_id.set(id, { id, name: short_fighter_id(id) })
  }
  for (const rows of [carried, resolved, mine])
    for (const row of rows ?? []) if (row?.id) by_id.set(String(row.id), row)
  return [...by_id.values()]
}

/** Stable identity of a composed roster — the change gate for re-publishing it through the ctx door. */
export const fight_roster_signature = (rows) =>
  (rows ?? [])
    .map((row) => {
      const nested = Array.isArray(row?.colors) ? null : row?.colors
      const colors = Array.isArray(row?.colors)
        ? row.colors
        : [
            row?.color_1 ?? nested?.color_1 ?? '',
            row?.color_2 ?? nested?.color_2 ?? '',
            row?.color_3 ?? nested?.color_3 ?? '',
          ]
      return [
        row?.id,
        row?.name ?? '',
        row?.classe ?? row?.class ?? '',
        row?.sex ?? '',
        typeof row?.male === 'boolean' ? row.male : '',
        ...colors,
      ].join(':')
    })
    .join('|')

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
