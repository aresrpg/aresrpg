// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// rpc/fight_journal.js — THE JOURNAL INGRESS EDGE (M2a, #291).
//
// The V2 event journal is FETCHED here, in the frontend read layer — never inside `@aresrpg/fight`, which
// is promise-free by law (L-P4, arch-fight-effect-free): the fight core executes NO effects; effects live
// at the edge and their results re-enter through the store's ONE input door (the M2b adoption door, wired
// later). This walker CONSUMES the pure `@aresrpg/fight` ingress modules (the normalizer + the u64
// discipline) and pages the read layer. The page-fetch is INJECTED (`fetch_page`, default the house
// `rpc_get` path) — the same dependency-injection seam `fight/txs.js` uses for `deps.submit`.
//
// PRE-DEPLOY TOLERANCE: the `/v1/fights/{id}/events` endpoint is not deployed to prod yet, so `rpc_get`
// throws `RpcError` (404) until it lands — exactly like `get_inbox`/`get_airdrops` do for their pending
// routes. The walker CATCHES that and degrades to `{ unavailable: true }` as data: a live consumer shows
// "no journal yet", it never throws.

import { normalize_journal_page } from '@aresrpg/fight/journal_normalize'
import { u64 } from '@aresrpg/fight/journal_u64'

import { rpc_get, RpcError } from './client'

const DEFAULT_LIMIT = 200 // mirrors the M1 server default (JOURNAL_DEFAULT_LIMIT, packages/rpc/api/views.js)
const MAX_WALK_PAGES = 4096 // a hard ceiling so a misreported head can never spin the walk forever

/**
 * Fetch ONE journal page (`GET /v1/fights/{id}/events?from&limit`). `rpc_get` throws `RpcError` on any
 * non-2xx (including the pre-deploy 404); the walker catches it. This is the production page-fetch — the
 * default `fetch_page` below. `from`/`limit` ride as u64 decimal strings (the client never Number-coerces
 * an ordinal — the 2^53 law; the server floors them itself).
 * @param {string} fight_id
 * @param {{ from?: string|number, limit?: string|number }} [query]
 * @param {AbortSignal} [signal]
 */
export const get_fight_events = (fight_id, { from = 0, limit = DEFAULT_LIMIT } = {}, signal) =>
  rpc_get(`/v1/fights/${fight_id}/events`, { from, limit }, signal)

/**
 * Walk contiguous journal pages from `from` up to the live `journal_head`, normalizing each page into the
 * pure `@aresrpg/fight` ingress batch (the shape the M2b accept machine folds). Cursor math is u64/BigInt,
 * never Number. A pre-deploy 404 (or any `RpcError`) degrades to `{ ok:false, unavailable:true }`; a
 * non-`RpcError` is a real bug and propagates. Returns the ordered normalized batches as data.
 * @param {string} fight_id
 * @param {{ from?: string|number, limit?: string|number, max_pages?: number, signal?: AbortSignal, fetch_page?: typeof get_fight_events }} [opts]
 */
export const paginate_fight_journal = async (
  fight_id,
  { from = 0, limit = DEFAULT_LIMIT, max_pages = MAX_WALK_PAGES, signal, fetch_page = get_fight_events } = {}
) => {
  let batches = []
  let cursor = u64(String(from)) ?? 0n
  let head = null

  for (let page_i = 0; page_i < max_pages; page_i++) {
    let page
    try {
      page = await fetch_page(fight_id, { from: cursor.toString(), limit }, signal)
    } catch (error) {
      // pre-deploy 404 / transport failure → unavailability as data; a non-RpcError is a real bug — rethrow.
      if (error instanceof RpcError)
        return { ok: false, unavailable: true, status: error.status, head: head?.toString() ?? null, batches }
      throw error
    }
    batches = [...batches, normalize_journal_page(page, { fight_id })]
    head = u64(String(page.journal_head)) ?? 0n
    const got = (page.events ?? []).length
    cursor += BigInt(got)
    if (got === 0 || cursor >= head) break // reached the live head, or a short page — nothing more to walk
  }

  return { ok: true, unavailable: false, head: head?.toString() ?? null, batches }
}
