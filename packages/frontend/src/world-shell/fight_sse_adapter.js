// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// FIGHT SSE — TRANSPORT ONLY (#1384, the client half of #1382). The read layer pushes the fight's journal
// instead of the client paging it; every frame becomes the SAME `{ type:'journal', fight_id, batch }` message
// the journal walker already produces and re-enters through the store's ONE input door. This module folds
// nothing, imports no core, and writes no store — it shapes bytes into the existing door message and hands it
// to the caller's `input`.
//
// THE WIRE (packages/rpc/indexer/src/stream.rs, #1382): `GET /v1/stream/fight/{fight_id}`, one SSE event named
// `fight` per journal row (`:276`), `data` = `{ kind, data, digest, version }` (`:267-272`), `id` = the fight
// cursor `<checkpoint>:<event_index>` (`:56-67`), resumed from the `Last-Event-ID` header (`:209-218`). Two
// frame shapes are accepted here, and nothing else: a journal PAGE (the batch the door already speaks — how a
// recorded capsule and any future paged frame arrive) rides through untouched, and ONE journal row is wrapped
// into a one-row page by the SAME normalizer the walker uses. A frame that is neither is not dropped in
// silence forever: it spends the finite budget below and then gives up honestly.
//
// TWO OPEN CONTRACT DELTAS vs the server half (#1398 — reported, not worked around):
//  · a browser cannot set headers on an EventSource, so the FIRST connect seeds its resume point as
//    `?lastEventId=` (the browser sends the header itself on its own reconnects); the route reads the header
//    only, so the seed is ignored until it also reads the query.
//  · the frame carries no journal `seq`, and the SSE id is a chain cursor, not the u64 ordinal the fold keys
//    on — so a live row is unfoldable until the frame carries its `seq`.
//
// GIVING UP HONESTLY: an EventSource retries FOREVER by default (a dead endpoint = an immortal silent retry
// loop). Attempts are counted against REJOIN_MAX_ATTEMPTS — the presence link's budget, imported so the number
// has ONE home — and the source is closed at the ceiling with a `failed` status + reason. `set_status` takes
// the presence link vocabulary (`connecting` | `connected` | `reconnecting` | `failed`) so the cutover wires it
// straight onto the existing `link_status` / `link_error` surface without inventing a state home.

import { normalize_journal_page } from '@aresrpg/fight/journal_normalize'
import { u64_string } from '@aresrpg/fight/journal_u64'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { RPC_URL } from '../env'

// The #1381 belt reads the fight DIRECTLY this long before a turn deadline — one scheduled read per deadline
// anchor, never a cadence: a stream gap must never cost the turn the deadline is about to end.
const DEADLINE_LEAD_MS = 5_000

const stream_url = (base_url, fight_id, cursor) => {
  const url = new URL(`${base_url}/v1/stream/fight/${encodeURIComponent(fight_id)}`)
  if (cursor != null && cursor !== '') url.searchParams.set('lastEventId', String(cursor))
  return url.toString()
}

/**
 * ONE SSE frame → the journal-door message, or null when the frame carries no foldable journal row.
 * @param {{ data?: string, lastEventId?: string }} event
 * @param {string} fight_id
 */
export function fight_stream_message(event, fight_id) {
  let body
  try {
    body = JSON.parse(event?.data ?? '')
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  // A PAGE is already the ingress batch — pass it through byte-identical (re-normalizing would re-key rows the
  // walker already keyed, and the fold must not be able to tell the two transports apart).
  if (body.source === 'journal' && Array.isArray(body.events))
    return { type: 'journal', fight_id, batch: { ...body, fight_id: body.fight_id ?? fight_id } }
  // ONE row (the #1382 frame). `seq` is the fold's ordinal — the SSE id is a chain cursor and serves only as a
  // fallback for a producer that stamps its ordinal there; a row with neither cannot be folded.
  const seq = body.seq ?? event?.lastEventId
  if (!body.kind || u64_string(seq) == null) return null
  const page = {
    fight: body.fight_id ?? fight_id,
    journal_head: body.head ?? body.journal_head ?? seq,
    events: [{ seq, kind: body.kind, data: body.data, digest: body.digest, version: body.version }],
  }
  return { type: 'journal', fight_id, batch: normalize_journal_page(page, { fight_id }) }
}

/**
 * Open ONE fight stream. Returns the closer (source + belt + subscription). Every injected seam is a function
 * so the transport stays headless-testable; nothing here reads a clock or a store directly.
 * @param {{
 *   fight_id: string, cursor?: () => string|null, input: (message:any, now:number) => void,
 *   base_url?: string, event_source_factory?: (url:string) => any, now?: () => number,
 *   set_status?: (status:string, error?:string|null) => void, max_attempts?: number,
 *   install_deadline_belt?: boolean, deadline?: () => number|null, direct_read?: () => Promise<any>,
 *   subscribe?: (listener: () => void) => () => void,
 *   set_timeout?: (fn: () => any, delay:number) => any, clear_timeout?: (handle:any) => void,
 * }} options
 */
export function open_fight_stream({
  fight_id,
  cursor,
  input,
  base_url = RPC_URL,
  event_source_factory = (url) => new EventSource(url),
  now = Date.now,
  set_status = () => {},
  max_attempts = REJOIN_MAX_ATTEMPTS,
  install_deadline_belt = true,
  deadline,
  direct_read,
  subscribe,
  set_timeout = (fn, delay) => setTimeout(fn, delay),
  clear_timeout = (handle) => clearTimeout(handle),
}) {
  const source = event_source_factory(stream_url(base_url, fight_id, cursor?.()))
  let status = 'idle'
  let attempts = 0
  let unusable = 0
  let closed = false

  const announce = (next, error = null) => {
    if (closed || next === status) return
    status = next
    set_status(next, error)
  }
  const give_up = (error) => {
    source.close()
    announce('failed', error)
  }

  const receive = (event) => {
    const message = fight_stream_message(event, fight_id)
    if (!message) {
      // Frames we cannot fold are a CONTRACT mismatch, not weather — tolerate the same finite budget as a
      // reconnect, then say so instead of dropping the fight's rows in silence.
      if ((unusable += 1) > max_attempts) give_up(`Fight stream frames are not journal rows (${unusable} frames)`)
      return
    }
    attempts = 0
    announce('connected')
    input(message, now())
  }

  source.onmessage = receive
  // #1382 names every fight frame `fight`; a named event never reaches `onmessage` on a real EventSource.
  source.addEventListener?.('fight', receive)
  source.onopen = () => {
    attempts = 0
    announce('connected')
  }
  source.onerror = () => {
    if (source.readyState === 2 || (attempts += 1) > max_attempts)
      return give_up(`Fight stream unavailable after ${attempts} attempts`)
    announce('reconnecting')
  }
  announce('connecting')

  // ── THE #1381 DEADLINE BELT — one direct read per deadline anchor, armed on open and re-armed whenever the
  // fold moves the anchor. Dedupe is the anchor itself: the same deadline never schedules twice.
  let belt_anchor = null
  let belt_timer = null
  const cancel_belt = () => {
    if (belt_timer != null) clear_timeout(belt_timer)
    belt_timer = null
  }
  const arm_belt = () => {
    const anchor = deadline?.() ?? null
    if (anchor === belt_anchor) return
    cancel_belt()
    belt_anchor = anchor
    if (anchor == null) return
    belt_timer = set_timeout(
      () => {
        belt_timer = null
        return direct_read?.()
      },
      Math.max(0, anchor - now() - DEADLINE_LEAD_MS)
    )
  }
  const unsubscribe = install_deadline_belt ? subscribe?.(arm_belt) : null
  if (install_deadline_belt) arm_belt()

  return () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    cancel_belt()
    source.close()
  }
}
