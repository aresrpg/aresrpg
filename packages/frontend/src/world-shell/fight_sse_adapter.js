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
// THE CONTRACT DELTAS ARE CLOSED (#1398): the route now reads `?lastEventId=` as well as the header (a browser
// cannot set headers on an EventSource, so the FIRST connect can only seed through the query), and every frame
// carries its journal `seq`, so a live row is foldable. ONE truth survives that: the resume id is a CHAIN cursor
// (`<checkpoint>:<event-index>`), NOT the u64 ordinal the fold keys on — so `cursor` is whatever the caller can
// honestly produce, and the cutover (fight_stream_link.js) produces none. A cursorless connect replays the
// fight's journal from its start and the accept machine drops everything at or below the fold's frontier:
// idempotence is the resume, and no second cursor is bookkept anywhere.
//
// GIVING UP HONESTLY: an EventSource retries FOREVER by default (a dead endpoint = an immortal silent retry
// loop). Attempts are counted against REJOIN_MAX_ATTEMPTS — the presence link's budget, imported so the number
// has ONE home — and the source is closed at the ceiling with a `failed` status + reason. `set_status` takes
// the presence link vocabulary (`connecting` | `connected` | `reconnecting` | `failed`) so the cutover wires it
// straight onto the existing `link_status` / `link_error` surface without inventing a state home.

import { merge_journal_batches, normalize_journal_page } from '@aresrpg/fight/journal_normalize'
import { u64_string } from '@aresrpg/fight/journal_u64'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { RPC_URL } from '../env'

// The #1381 belt reads the fight DIRECTLY this long before a turn deadline — one scheduled read per deadline
// anchor, never a cadence: a stream gap must never cost the turn the deadline is about to end.
const DEADLINE_LEAD_MS = 5_000

// THE COALESCING WINDOW (#1649). The chain emits ONE event batch per transaction, and the fight presents PER
// BATCH — a peer's whole turn is one ~3s slot. This wire cuts that batch into one row per frame (`:276`), so a
// door fed frame-by-frame buys a slot per ROW: a five-row peer turn would take fifteen seconds to watch. Rows
// are held for this window and handed over as ONE batch — the transport reassembles exactly what the wire
// fragmented, and nothing downstream can tell the two deliveries apart. It is deliberately shorter than any
// human-perceptible delay and far shorter than the chain's own min-turn, so two LIVE transactions can never
// share a window (a delivery that does carry several is a catch-up, and the fold treats it as one).
export const JOURNAL_COALESCE_MS = 120

const stream_url = (base_url, fight_id, cursor) => {
  const url = new URL(`${base_url}/v1/stream/fight/${encodeURIComponent(fight_id)}`)
  if (cursor != null && cursor !== '') url.searchParams.set('lastEventId', String(cursor))
  return url.toString()
}

/**
 * ONE SSE frame → `{ message, whole }`: the journal-door message plus whether the frame already carried a WHOLE
 * batch. A PAGE is whole (the walker's own wire — nothing fragmented it, so it never enters the coalescing
 * window); a single #1382 row is a fragment. Null when the frame carries no foldable journal row.
 * @param {{ data?: string, lastEventId?: string }} event
 * @param {string} fight_id
 */
export function fight_stream_frame(event, fight_id) {
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
    return {
      message: { type: 'journal', fight_id, batch: { ...body, fight_id: body.fight_id ?? fight_id } },
      whole: true,
    }
  // ONE row (the #1382 frame). `seq` is the fold's ordinal — the SSE id is a chain cursor and serves only as a
  // fallback for a producer that stamps its ordinal there; a row with neither cannot be folded.
  const seq = body.seq ?? event?.lastEventId
  if (!body.kind || u64_string(seq) == null) return null
  const page = {
    fight: body.fight_id ?? fight_id,
    journal_head: body.head ?? body.journal_head ?? seq,
    events: [{ seq, kind: body.kind, data: body.data, digest: body.digest, version: body.version }],
  }
  return { message: { type: 'journal', fight_id, batch: normalize_journal_page(page, { fight_id }) }, whole: false }
}

/** ONE SSE frame → the journal-door message alone, or null. The frame's shape is `fight_stream_frame`'s answer. */
export const fight_stream_message = (event, fight_id) => fight_stream_frame(event, fight_id)?.message ?? null

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
  clear_timeout = clearTimeout,
  coalesce_ms = JOURNAL_COALESCE_MS,
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

  // ── THE COALESCING WINDOW: the fragments of one chain batch are reassembled here and enter the door ONCE.
  let held = null
  let held_timer = null
  const flush_held = () => {
    if (held_timer != null) clear_timeout(held_timer)
    held_timer = null
    const batch = held
    held = null
    if (batch) input({ type: 'journal', fight_id, batch }, now())
  }
  const hold = (batch) => {
    held = held ? merge_journal_batches(held, batch) : batch
    if (coalesce_ms <= 0) return flush_held() // no window ⇒ no buffering at all (the raw per-frame contract)
    if (held_timer == null) held_timer = set_timeout(flush_held, coalesce_ms)
  }

  const receive = (event) => {
    const frame = fight_stream_frame(event, fight_id)
    if (!frame) {
      // Frames we cannot fold are a CONTRACT mismatch, not weather — tolerate the same finite budget as a
      // reconnect, then say so instead of dropping the fight's rows in silence.
      if ((unusable += 1) > max_attempts) give_up(`Fight stream frames are not journal rows (${unusable} frames)`)
      return
    }
    attempts = 0
    announce('connected')
    // A WHOLE batch is not a fragment: it flushes whatever the window still holds (so the door keeps seeing the
    // stream in chain order) and rides straight through, byte-identical.
    if (frame.whole) {
      flush_held()
      input(frame.message, now())
      return
    }
    hold(frame.message.batch)
  }

  source.addEventListener?.('message', receive)
  // #1382 names every fight frame `fight`; a named event never reaches `onmessage` on a real EventSource.
  source.addEventListener?.('fight', receive)
  source.addEventListener?.('open', () => {
    attempts = 0
    announce('connected')
  })
  source.addEventListener?.('error', () => {
    if (source.readyState === 2 || (attempts += 1) > max_attempts)
      return give_up(`Fight stream unavailable after ${attempts} attempts`)
    announce('reconnecting')
  })
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
    flush_held() // a row already on this client is never dropped on the floor because the fight ended its stream
    unsubscribe?.()
    cancel_belt()
    source.close()
  }
}
