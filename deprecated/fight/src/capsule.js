// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// capsule.js — the bounded capture ring + the trace_format-2 dump shape (V2 build step 1, commit ②).
//
// The recorder tee holds a BOUNDED ring of `input_envelope`s (memory-safe on a long session); the
// export affordance shapes the current ring into a portable capsule file. Both live here, node-clean
// and pure, so the frontend tee and the historical-corpus converter share ONE ring bound and ONE dump
// shape — a capsule the V2 core will replay byte-for-byte.

import { ENVELOPE_VERSION } from './envelope.js'

// trace_format 1 = the legacy `{ seq, at, msg }` input dump (still produced/consumed for back-compat);
// trace_format 2 = this envelope-capsule dump. The reader keys on it.
export const TRACE_FORMAT_LEGACY = 1
export const TRACE_FORMAT_ENVELOPE = 2

// The ring holds a whole real fight and then some — the largest capture in the historical corpus is
// ~1,750 inputs; 4,096 clears it with headroom. A session that outruns the bound rings oldest-out (the
// tail is what a desync post-mortem needs), never growing unbounded.
export const CAPSULE_RING_LIMIT = 4096

/**
 * push_bounded — append `item`, keeping at most `limit` newest entries (oldest ring out). Returns a NEW
 * array (immutable — the fight-core FP law); does no serialization, so it is cheap enough for the tee's
 * hot path (a slice of ≤ limit references).
 * @template T @param {readonly T[]} ring @param {T} item @param {number} [limit]
 * @returns {T[]}
 */
export const push_bounded = (ring, item, limit = CAPSULE_RING_LIMIT) => {
  const base = ring.length >= limit ? ring.slice(ring.length - limit + 1) : ring.slice()
  base.push(item)
  return base
}

/**
 * capsule_export — shape a ring of envelopes into a portable trace_format-2 capsule. `flags` records
 * unknowables/approximations about the capture (e.g. a converted historical file whose original arrival
 * timing was reconstructed from event order) per the decode-tests provenance law.
 * @param {{ session_id?: string|null, app_version?: string|null, captured_at: number,
 *           capsules: object[], flags?: object }} fields
 */
export const capsule_export = ({ session_id = null, app_version = null, captured_at, capsules, flags }) => ({
  trace_format: TRACE_FORMAT_ENVELOPE,
  envelope_version: ENVELOPE_VERSION,
  app_version,
  session_id,
  captured_at,
  ...(flags ? { flags } : {}),
  capsules,
})
