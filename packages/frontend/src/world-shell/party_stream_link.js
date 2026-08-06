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
//    Both are ordinary states here: the carriers report not-live and the four-second poll is untouched. A 404 is
//    also FINAL (#2261) — it retires the wire for the session instead of being retried like a hiccup.
//  · THE TTL DRAIN — an outgoing invite nobody ever answers expires on `INVITE_PENDING_TTL_MS`, checked for free
//    on every poll-driven snapshot. Nothing changes in the projection when a question is simply ignored, so the
//    push is silent by design and only the clock can drain it.
//  · SELF-HEALING — a stream that silently stops carrying is indistinguishable from a quiet party; a slow
//    reconciliation read is the only honest floor under that.

import { POLL_MS, PUSHED_RECONCILE_MS } from '@aresrpg/party/reduce'
import { REJOIN_MAX_ATTEMPTS } from '@aresrpg/world/presence'

import { game_log } from '../core/log.js'
import { RPC_URL } from '../env'

import { is_definitive_stream_status, probe_stream_status } from './stream_status.js'

export { probe_stream_status } from './stream_status.js'

// A dead endpoint must not double this client's request rate: a failed connect skips ticks on a doubling ladder,
// from the next tick up to fifteen of them (a minute at the poll cadence — the fight link's own ceiling). That
// ladder covers the TRANSIENT classes only — a restarting location, a dropped connection, a timeout.
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
 *   probe?: (url: string) => Promise<number|null>, base_url?: string,
 *   set_timeout?: (fn: () => any, delay: number) => any, clear_timeout?: (handle: any) => void,
 * }} options the remaining options (`event_source_factory`, …) pass straight to the stream.
 */
export function start_party_carriers({
  character_id,
  refresh,
  open = open_party_stream,
  probe = probe_stream_status,
  base_url = RPC_URL,
  set_timeout = (fn, delay) => setTimeout(fn, delay),
  clear_timeout = clearTimeout,
  ...stream
}) {
  let closed = false
  let live = false
  let attempt = 0
  let skip_ticks = 0
  let retired = false
  let classifying = false
  let announced = /** @type {string|null} */ (null)
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
    attempt += 1
    skip_ticks = Math.min(MAX_SKIPPED_TICKS, 2 ** (attempt - 1))
  }

  /**
   * ONE line per distinct reason, not one per attempt (#2261): a dead endpoint used to narrate every retry into
   * the breadcrumb ring, which is how the run-up to the NEXT reported error got flushed by its own noise. The
   * text carries what actually happened — the status and the url — so it is diagnosable without a re-run.
   */
  const breadcrumb = (/** @type {string} */ text) => {
    if (text === announced) return
    announced = text
    game_log('party', text)
  }

  /**
   * Classify ONE terminal failure: definitive (the location answers 404/410 — the route is not there) or
   * transient (anything else, including no response at all). Exactly one probe is in flight at a time, and none
   * at all once the wire is retired.
   */
  const classify = async (/** @type {string} */ url, /** @type {string|null} */ reason) => {
    if (classifying) return
    classifying = true
    const status = await probe(url)
    classifying = false
    if (closed) return
    if (is_definitive_stream_status(status)) {
      retired = true
      drop_stream()
      breadcrumb(`party stream retired — ${url} answered ${status}; the party rides the poll for this session`)
      return
    }
    breadcrumb(
      `party stream dropped — ${reason ?? 'no reason given'} (${url} answered ${status ?? 'nothing'}); retrying, poll carrying`
    )
  }

  const status_changed = (/** @type {string} */ status, /** @type {string|null} */ error) => {
    if (closed) return
    if (status === 'connected') {
      live = true
      attempt = 0
      skip_ticks = 0
      announced = null
      return
    }
    live = false
    // `failed` is the transport's terminal status — the source is CLOSED and its retry budget spent. What it is
    // NOT is a diagnosis: `EventSource` reports a missing route and a severed socket identically, so the class
    // is asked of the location itself before the ladder is allowed to keep spending requests on it.
    if (status !== 'failed') return
    const url = stream_url(base_url, streamed ?? '')
    back_off()
    void classify(url, error)
  }

  /** Open the stream for the selected character when there is none, or when selection moved. */
  const align = () => {
    if (closed) return
    const id = character_id()
    // Selection moving is a RE-KEY: the old subscription is dropped and the new character never waits out the
    // old one's backoff — it has its own subscription to prove. Anything else leaves the ladder's state alone
    // (clearing it here is what turned the backoff into a per-tick hot loop — #2261).
    if (id !== streamed) {
      drop_stream()
      streamed = id
      attempt = 0
      skip_ticks = 0
    }
    if (close_stream || !id || retired || skip_ticks > 0) return
    try {
      close_stream = open({
        ...stream,
        base_url,
        character_id: id,
        on_change: () => refresh(),
        set_status: status_changed,
      })
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
