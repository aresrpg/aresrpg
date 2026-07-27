// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// snapshot_reconcile.js — the ONE pure decision for whether a Fight OBJECT may replace the canonical fold base.
// Object version orders object writes; journal head orders fight EVENTS. A read behind the accepted event cursor is
// stale even when its object version is larger, so it must never raise the fold floor over already-consumed rows.

import { u64 } from './journal_u64.js'

/**
 * Decide one whole-snapshot reconciliation. There is no merge arm:
 *   · discard  — the read is behind, duplicate, or cannot prove its cursor after events were accepted;
 *   · adopt    — bootstrap, or a whole read aligned with/ahead of the accepted event cursor.
 *
 * `snapshot_head` is an event COUNT; `accepted_head` is the highest accepted zero-based seq.
 * @param {{
 *   has_base:boolean,
 *   base_version:number,
 *   event_version:number,
 *   read_version:number,
 *   accepted_head?:string|number|bigint|null,
 *   snapshot_head?:string|number|bigint|null
 * }} input
 * @returns {{ kind:'adopt'|'discard', reason:string, snapshot_head:string|null }}
 */
export const snapshot_reconcile = ({
  has_base,
  base_version,
  event_version,
  read_version,
  accepted_head = null,
  snapshot_head = null,
}) => {
  const version = Number(read_version ?? 0)
  const base = Number(base_version ?? -1)
  const event = Number(event_version ?? -1)
  const read_head = u64(snapshot_head)
  const accepted = u64(accepted_head)
  const cursor = read_head == null ? null : read_head.toString()

  // Bootstrap is the only exception: without any decoded base the event tail cannot resolve roster identities.
  // Once that whole base exists, every replacement must prove its event prefix below.
  if (!has_base) return { kind: 'adopt', reason: 'bootstrap', snapshot_head: cursor }

  if (read_head != null) {
    const accepted_next = accepted == null ? 0n : accepted + 1n
    if (read_head < accepted_next) return { kind: 'discard', reason: 'event_cursor_behind', snapshot_head: cursor }
  } else if (accepted != null || event > base) {
    return { kind: 'discard', reason: 'event_cursor_missing', snapshot_head: null }
  }

  if (version <= base) return { kind: 'discard', reason: 'base_not_newer', snapshot_head: cursor }

  if (read_head != null) {
    const accepted_next = accepted == null ? 0n : accepted + 1n
    if (version < event) return { kind: 'discard', reason: 'event_version_behind', snapshot_head: cursor }
    return {
      kind: 'adopt',
      reason: read_head === accepted_next ? 'event_cursor_aligned' : 'event_cursor_ahead',
      snapshot_head: cursor,
    }
  }

  // A source that omits its event cursor cannot prove it subsumes accepted rows. This keeps the current gRPC
  // placement poll useful before any event has landed (creator learns a joiner) but inert once a receipt/journal
  // has advanced the fold. A standalone headless-core replay has no accepted seq; there object version is its only
  // shared coordinate, so a strictly-ahead object remains a valid whole checkpoint.
  return version > event
    ? { kind: 'adopt', reason: 'object_cursor_ahead', snapshot_head: null }
    : { kind: 'discard', reason: 'object_cursor_not_ahead', snapshot_head: null }
}
