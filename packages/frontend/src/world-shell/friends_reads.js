// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FRIENDS reads (S-18 Command Roster) — assemble the roster the page renders. TWO honest data sources, no fakes:
//   1. The friend list itself = chain-direct via the SDK grpc (`get_friend_list_by_owner`) — the soulbound
//      whitelist of addresses. Null/empty until the social package is stamped + the player creates a list.
//   2. Per-friend enrichment (name/class/level/location) = the /v1 read-API (`get_characters?owner`), the same
//      indexer the rest of the app reads. `level` is `null` until object-snapshot indexing lands (views.ts) —
//      the row renders the gap ('—'), never a fake number. The row carries `position_fresh`: a labelled fact
//      about the READ LAYER, never a verdict about the player (advisory-only law — see friends_display.js).
//
// UI-DATA LAW (DECISIONS 07-08): a friends list may lag seconds and self-heals on focus — driven by useRpcView.

import { get_friend_list_by_owner } from '@aresrpg/sdk/social'

import { get_characters, rpc_get, RpcError } from '../rpc/client'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'

// The read layer's last-known position for a character counts as FRESH within this window. That is all it
// means: not "online", and its absence is not "offline" — an unfresh position is simply a fact we do not have.
const POSITION_FRESH_WINDOW_MS = 5 * 60 * 1000

/** Resolve the caller's soulbound friend list (chain-direct). `{ list_id, friends: address[] }`; list_id null =
 *  no roster yet (the seam's `null`, drives the create-on-first-add flow).
 *  A FAILED read THROWS (#2057): the seam stopped merging "failed" into "absent" (#2054), and this hop keeps
 *  that discrimination — the caller's degraded treatment says we know nothing, instead of painting a
 *  confident empty roster over a dead transport. */
export async function read_friend_list(address) {
  if (!address) return { list_id: null, friends: [] }
  const { grpc_client } = await get_sdk()
  const fl = await get_friend_list_by_owner({ grpc_client, network: DEMO_NETWORK })(address)
  return { list_id: fl?.id ?? null, friends: fl?.friends ?? [] }
}

/**
 * Exact, case-insensitive character-name lookup through the keyless `/v1` read layer. The API returns an array
 * even though the on-chain creation gate makes names globally unique; preserving that envelope keeps callers
 * fail-closed if legacy/corrupt projection data ever yields multiple rows.
 * @param {string} name
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{name:string, character_id:string, owner:string, level:number|null, class:string|null}>>}
 */
export async function get_owner_by_name(name, signal) {
  const exact_name = String(name ?? '').trim()
  if (!exact_name) return []
  let body
  try {
    body = await rpc_get('/v1/names', { name: exact_name }, signal)
  } catch (error) {
    // A 400 means the string cannot be a character name (grammar/length: 4–19 printable ASCII) — a definitive
    // "no character by that name", NOT an outage. Return [] so the add flow falls through to the SuiNS fallback
    // (which handles longer/`@`-form handles) instead of surfacing the generic "couldn't look up" toast.
    if (error instanceof RpcError && error.status === 400) return []
    throw error
  }
  if (!Array.isArray(body?.matches)) throw new Error('name lookup returned a malformed response')
  return body.matches
}

/** Pick the friend's most-relevant character: the one with the freshest known position, else the first. */
function primary_character(chars) {
  if (!chars?.length) return null
  return [...chars].sort((a, b) => (b.position?.at_ms ?? 0) - (a.position?.at_ms ?? 0))[0]
}

/** A zone label from a character position — prefer the indexer's own `zone`, else derive from block coords. */
function zone_label(position) {
  if (!position) return null
  if (position.zone) return String(position.zone)
  const { x, z } = position
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return `${Math.floor(x / 512)}.${Math.floor(z / 512)}`
}

/**
 * The full enriched roster for `address`: `{ list_id, rows }`, one row per friend address. Rows carry only
 * honest fields (null where the indexer can't resolve). Enrichment runs in ONE atomic poll (Promise.all) so the
 * whole roster is consistent per tick; a per-friend read failure degrades that row to address-only, never throws.
 * The LIST read itself is NOT best-effort: its failure propagates (#2057) so the caller renders degraded.
 * @param {string | null} address
 * @param {AbortSignal} [signal]
 */
export async function read_roster(address, signal) {
  const { list_id, friends } = await read_friend_list(address)
  const now = Date.now()
  const rows = await Promise.all(
    friends.map(async (friend) => {
      let chars = []
      try {
        chars = await get_characters({ owner: friend }, signal)
      } catch {
        /* enrichment best-effort — the row still renders from the raw address */
      }
      const char = primary_character(chars)
      const at_ms = char?.position?.at_ms ?? null
      const world = char?.world ?? null
      return {
        address: friend,
        name: char?.name ?? null,
        class: char?.class ?? null,
        level: char?.level ?? null, // null until object-snapshot indexing lands — rendered as '—'
        // The friend's on-chain job total_xp map (/v1 `jobs`) — the COMMISSION customer view derives each
        // friend-artisan's craftable recipes from it; `{}` until the character indexes (an artisan with no
        // known craft levels renders with an empty recipe list, never a crash). OnlinePlayers ignores this.
        jobs: char?.jobs ?? {},
        world,
        // Preserve every already-fetched id→world join so the action can match the wallet's live p2p character
        // instead of re-guessing an arbitrary owned alt. The shared resolver still verifies this /v1 route.
        routes: chars.map((candidate) => ({ character_id: candidate.id, world_id: candidate.world ?? null })),
        zone: zone_label(char?.position),
        position_fresh: at_ms != null && now - at_ms < POSITION_FRESH_WINDOW_MS,
      }
    })
  )
  return { list_id, rows }
}
