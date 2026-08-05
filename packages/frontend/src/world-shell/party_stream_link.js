// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE PARTY CARRIERS (#2086) — party membership and pending invitations used to reach this client on ONE
// four-second poll while the read layer already pushed fight rows over SSE. The invite leg was the felt wait: a
// leader hit "invite" and the invitee's card showed up whenever the next tick happened to land. This module owns
// the TRANSPORT half of that: the pushed channel plus the reconciliation clock. It shapes no domain state, holds
// no store, and knows exactly one verb — `refresh`, the store's existing authoritative read.
//
// THE WIRE (packages/rpc/indexer/src/stream/party.rs): `GET /v1/stream/party/{character_id}`, one SSE event named
// `party` carrying `{ party, invites }` — the RAW projection pointers, emitted only when they CHANGE. It is a
// LEVEL channel, not a journal: the newest frame subsumes every earlier one, so there is no cursor to resume from
// and a reconnect resyncs by being handed the current level as its first frame.
//
// WHY THE FRAME IS A SIGNAL AND NOT THE PAYLOAD. The shaped party and invite documents (kiosk-owner resolution,
// the fail-closed membership re-check, the "already a member" filter) have ONE home — packages/rpc/api/parties_view.js
// — and a second Rust rendering of them would be exactly the multi-source-of-truth this repo hunts. So the frame
// says "your scope moved" and the client answers with the read it always had, through the ONE reducer door
// (party_store.refresh → `snapshot` + the carrier's `event:'invite'`). The transport changed; the door did not.
//
// WHY THE POLL SURVIVES (three jobs the wire cannot do, mirroring fight_stream_link.js):
//  · FALLBACK — a location may not serve `/v1/stream/*` yet (404) and a runtime may have no `EventSource` at all.
//    Both are ordinary states here: the carriers report not-live and the four-second poll is untouched.
//  · THE TTL DRAIN — an outgoing invite nobody ever answers expires on `INVITE_PENDING_TTL_MS`, checked for free
//    on every poll-driven snapshot. Nothing changes in the projection when a question is simply ignored, so the
//    push is silent by design and only the clock can drain it.
//  · SELF-HEALING — a stream that silently stops carrying is indistinguishable from a quiet party; a slow
//    reconciliation read is the only honest floor under that.

import { POLL_MS, PUSHED_RECONCILE_MS } from '@aresrpg/party/reduce'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { game_log } from '../core/log.js'
import { RPC_URL } from '../env'

// A dead endpoint must not double this client's request rate: a failed connect skips ticks on a doubling ladder,
// from the next tick up to fifteen of them (a minute at the poll cadence — the fight link's own ceiling). The
// whole pre-deploy 404 window lives on this ladder, and the poll is unaffected by it.
const MAX_SKIPPED_TICKS = 15

const stream_url = (base_url, character_id) => `${base_url}/v1/stream/party/${encodeURIComponent(character_id)}`

/**
 * Open ONE party scope stream. Transport only: every frame becomes a single `on_change()` call. Returns the
 * closer. Every seam is injected so this stays headless-testable and reads no clock or store of its own.
 * @param {{
 *   character_id: string, on_change: (scope: any) => void, base_url?: string,
 *   event_source_factory?: (url: string) => any, set_status?: (status: string, error?: string|null) => void,
 *   max_attempts?: number,
 * }} options
 */
export function open_party_stream({
  character_id,
  on_change,
  base_url = RPC_URL,
  event_source_factory = (url) => new EventSource(url),
  set_status = () => {},
  max_attempts = REJOIN_MAX_ATTEMPTS,
}) {
  const source = event_source_factory(stream_url(base_url, character_id))
  let status = 'idle'
  let attempts = 0
  let closed = false

  const announce = (next, error = null) => {
    if (closed || next === status) return
    status = next
    set_status(next, error)
  }

  const receive = (event) => {
    attempts = 0
    announce('connected')
    // The frame is a change SIGNAL: its body is logged for provenance and never folded, because the shaped truth
    // has one home and `on_change` is what goes and reads it.
    let scope = null
    try {
      scope = JSON.parse(event?.data ?? 'null')
    } catch {
      scope = null
    }
    on_change(scope)
  }

  source.addEventListener?.('message', receive)
  // The route names every frame `party`; a named event never reaches `onmessage` on a real EventSource.
  source.addEventListener?.('party', receive)
  source.addEventListener?.('open', () => {
    attempts = 0
    announce('connected')
  })
  source.addEventListener?.('error', () => {
    if (source.readyState === 2 || (attempts += 1) > max_attempts) {
      source.close()
      announce('failed', `Party stream unavailable after ${attempts} attempts`)
      return
    }
    announce('reconnecting')
  })
  announce('connecting')

  return () => {
    if (closed) return
    closed = true
    source.close()
  }
}

/**
 * Start BOTH carriers for whichever character is currently selected: the pushed scope stream and the
 * reconciliation clock. Returns the stop function the store keeps.
 *
 * The stream is keyed by character, so selection moving is a RE-KEY, not a filter — the old subscription is
 * closed and a new one opened for the new character, checked on every tick so no call site has to remember.
 * @param {{
 *   character_id: () => string|null, refresh: () => any, open?: typeof open_party_stream,
 *   set_timeout?: (fn: () => any, delay: number) => any, clear_timeout?: (handle: any) => void,
 * }} options the remaining options (`event_source_factory`, `base_url`, …) pass straight to the stream.
 */
export function start_party_carriers({
  character_id,
  refresh,
  open = open_party_stream,
  set_timeout = (fn, delay) => setTimeout(fn, delay),
  clear_timeout = clearTimeout,
  ...stream
}) {
  let closed = false
  let live = false
  let attempt = 0
  let skip_ticks = 0
  let streamed = /** @type {string|null} */ (null)
  let close_stream = /** @type {(() => void) | null} */ (null)
  let timer = /** @type {any} */ (null)

  const drop_stream = () => {
    close_stream?.()
    close_stream = null
    live = false
  }

  /** A connect that did not stick costs the next `2^attempt` ticks, capped — never the poll, only the retry. */
  const back_off = () => {
    drop_stream()
    streamed = null
    attempt += 1
    skip_ticks = Math.min(MAX_SKIPPED_TICKS, 2 ** (attempt - 1))
  }

  const status_changed = (/** @type {string} */ status, /** @type {string|null} */ error) => {
    if (closed) return
    if (status === 'connected') {
      live = true
      attempt = 0
      skip_ticks = 0
      return
    }
    live = false
    // `failed` is the transport's terminal status — a spent retry budget, and exactly what a 404 looks like. The
    // ladder owns that whole window; until it reconnects, the four-second poll is the carrier again.
    if (status !== 'failed') return
    game_log('party', `party stream dropped — reconciling on the poll (${error ?? 'no reason given'})`)
    back_off()
  }

  /** Open the stream for the selected character when there is none, or when selection moved. */
  const align = () => {
    if (closed) return
    const id = character_id()
    if (close_stream && id === streamed) return
    drop_stream()
    // Selection moving is a re-key and must never wait out a dead endpoint's backoff: the new character has its
    // own subscription to prove.
    if (id !== streamed) skip_ticks = 0
    streamed = id
    if (!id || skip_ticks > 0) return
    try {
      close_stream = open({ ...stream, character_id: id, on_change: () => refresh(), set_status: status_changed })
    } catch {
      // No `EventSource` in this runtime (or a constructor that refused the url): unavailability is DATA here —
      // the poll keeps carrying the party and the ladder keeps trying. Never a throw into the caller.
      back_off()
    }
  }

  /** One self-rescheduling reconciliation tick: fast while nothing pushes, slow while the wire carries. */
  const tick = () => {
    if (closed) return
    if (skip_ticks > 0) skip_ticks -= 1
    align()
    refresh()
    timer = set_timeout(tick, live ? PUSHED_RECONCILE_MS : POLL_MS)
  }

  align()
  timer = set_timeout(tick, POLL_MS)

  return () => {
    if (closed) return
    closed = true
    if (timer != null) clear_timeout(timer)
    timer = null
    drop_stream()
    streamed = null
  }
}
