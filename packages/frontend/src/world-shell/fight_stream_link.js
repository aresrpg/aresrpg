// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SSE CUTOVER (#1384) — the LINK that keeps ONE fight stream alive for the currently bound fight. The
// adapter (fight_sse_adapter.js) shapes bytes into the journal-door message; this owns only the LIFECYCLE:
// connect, catch up, survive a dead endpoint, retry.
//
// TWO DUMB BYTE SOURCES, ONE EVERYTHING ELSE. The stream and the REST pager (rpc/fight_journal.js) carry the
// same rows and are the only difference between them: BOTH hand their bytes to the ONE normalizer
// (`@aresrpg/fight/journal_normalize`) and enter the ONE fold door (`fight_store.input`). Nothing here shapes,
// translates, or renames an event, and there is NO per-transport cursor: the resume point is the FOLD's own
// accepted head (the journal `seq` frontier the pager already walks from), read fresh by both paths. A
// cursorless stream connect replays the fight's journal from its start (stream.rs `read_fight_events`, `-inf`)
// and the accept machine discards everything at or below the frontier — so resume needs no bookkeeping to drift.
//
// WHY THE PAGER SURVIVES THE CUTOVER (three jobs the wire cannot do):
//  · CATCH-UP — journal rows written before the SSE route shipped carry no chain cursor and are skipped by the
//    stream on purpose (stream.rs `decode_stored_fight_event`), so only the page can deliver them. One walk on
//    every connect.
//  · FALLBACK — a location may not serve `/v1/stream/*` (404), and a runtime may have no `EventSource` at all.
//    Both are ordinary states here, not errors: the link reports itself not-live and the 4s poll keeps paging.
//  · THE DEADLINE BELT — the adapter's #1381 belt fires ONE direct read before each turn deadline, so a silent
//    stream can never cost the turn the deadline is about to end.

import { open_fight_stream } from './fight_sse_adapter.js'

// A dead endpoint must not become a hot loop: the retry doubles from one poll period up to a minute. The
// pre-deploy 404 window lives entirely on this ladder.
const RETRY_BASE_MS = 4_000
const RETRY_MAX_MS = 60_000

/**
 * Bind ONE fight to the stream. Returns the live handle; `is_live()` is what tells the poll whether the wire is
 * carrying the fight's rows or whether paging still owns it. Every seam is injected so this stays headless.
 * @param {{ fight_id: string, catch_up: () => Promise<any>, open?: typeof open_fight_stream,
 *   set_timeout?: (fn: () => any, delay: number) => any, clear_timeout?: (handle: any) => void }} options the
 *   remaining options (`input`, `deadline`, `direct_read`, `subscribe`, …) pass straight to the adapter.
 */
export function bind_fight_stream({
  fight_id,
  catch_up,
  open = open_fight_stream,
  set_timeout = (fn, delay) => setTimeout(fn, delay),
  clear_timeout = clearTimeout,
  ...stream
}) {
  let live = false
  let attempt = 0
  let closed = false
  let close_stream = /** @type {(() => void) | null} */ (null)
  let retry_timer = /** @type {any} */ (null)

  const retry_later = () => {
    close_stream?.()
    close_stream = null
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
    attempt += 1
    retry_timer = set_timeout(connect, delay)
  }

  const status_changed = (/** @type {string} */ status) => {
    if (closed) return
    if (status === 'connected') {
      live = true
      attempt = 0
      // Legacy rows never stream, and a reconnect may have missed rows the fold has not accepted — the page is
      // the only path to both. One walk per connect, through the same door the frames use.
      void catch_up()
      return
    }
    live = false
    // `failed` is the adapter's terminal status: the retry budget is spent and the source is CLOSED. That is
    // also exactly what a 404 looks like, so the ladder below owns the whole pre-deploy window.
    if (status === 'failed') retry_later()
  }

  function connect() {
    retry_timer = null
    if (closed) return
    try {
      close_stream = open({ ...stream, fight_id, set_status: status_changed })
    } catch {
      // No `EventSource` in this runtime (or a constructor that refused the url): unavailability is DATA here —
      // the fight keeps paging and the ladder keeps trying. Never a throw into the caller's poll.
      live = false
      retry_later()
    }
  }

  connect()

  return {
    fight_id,
    is_live: () => live,
    close() {
      if (closed) return
      closed = true
      live = false
      if (retry_timer != null) clear_timeout(retry_timer)
      retry_timer = null
      close_stream?.()
      close_stream = null
    },
  }
}
