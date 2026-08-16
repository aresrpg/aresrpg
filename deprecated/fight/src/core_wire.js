// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// core_wire.js — the DECODE SEAM (consensus §①). The one place untrusted capsule/chain wire
// bytes become domain values, so the pure core never touches a raw wire shape. Two decodes live here and nowhere
// else (one home): the `$bigint` un-wrap the capsule export leaves behind, and the chain-event coordinate.
//
// PURE, node-clean, NO THROW: a shape it cannot read is returned as DATA (never an exception), so `ingest` stays
// total. Decode-once-at-the-seam is the FP-constitution boundary rule — the fold downstream sees only clean data.

import { ITEM_STAT_SHIFT as SIGNED_SHIFT } from '@aresrpg/sim/equipment_stats'
import { K_ALTER_RESIST, K_ALTER_STAT } from '@aresrpg/sim/spell_effect'

const STATUS_SIGNED_KINDS = new Set([K_ALTER_STAT, K_ALTER_RESIST])
const status_fields = (value) => value?.fields ?? value ?? {}
const status_number = (value) => (value == null || value === '' ? null : Number(value))

/** Does this status kind ride its value centered on the wire? */
export const is_signed_status_kind = (kind) => STATUS_SIGNED_KINDS.has(Number(kind))

/** Decode the centered u64 used by signed status kinds; every other value passes through. */
export const decode_status_value = (kind, value) =>
  value == null || !is_signed_status_kind(kind) ? value : value - SIGNED_SHIFT

/**
 * ONE status-wire normalizer for both authoritative transports. A Fight object wraps the effect under
 * `FighterStatus.effect` and carries the live counter/source beside it; an ActionEffect journal row carries the
 * same Effect fields flat and supplies those two values from its envelope. Both leave this door speaking exactly
 * the fold's status-row dialect. Total: an unreadable kind/counter returns null.
 * @param {unknown} raw
 * @param {{ remaining_turns?:unknown, source?:unknown }} [overrides]
 * @returns {{ kind:number, remaining_turns:number, element:number|null, value:number|null, stat:number|null,
 *   chance:number|null, source:number|null, flags?:number|null } | null}
 */
export const decode_status_row = (raw, overrides = {}) => {
  const row = status_fields(raw)
  const effect = status_fields(row.effect ?? row)
  const kind = Number(row.kind ?? effect.kind)
  const remaining_turns = Number(overrides.remaining_turns ?? row.remaining_turns ?? effect.turns ?? 0)
  if (!Number.isFinite(kind) || !Number.isFinite(remaining_turns)) return null
  const flags = status_number(effect.flags)
  return {
    kind,
    remaining_turns,
    element: status_number(effect.element),
    value: decode_status_value(kind, status_number(effect.value)),
    stat: status_number(effect.stat),
    chance: status_number(effect.chance),
    source: status_number(overrides.source ?? row.source),
    ...(flags != null ? { flags } : {}),
  }
}

/**
 * revive_wire — recursively un-wrap the capsule export's BigInt envelope `{ "$bigint": "123" }` back to the native
 * Sui-JSON u64 STRING shape (`"123"`) the chain decoders already consume (`board_state_from_fight` reads u64 fields
 * through `Number(...)` / `BigInt(...)`, both of which accept the string). A capsule serialized its BigInts this way
 * (JSON has no BigInt); without this un-wrap `decode_shape_mask`'s `BigInt({…})` throws on every snapshot (measured:
 * 592/592 capsule snapshots). Returns a FRESH value — never mutates the input (the fold law). Total: any non-wrapper
 * object/array is walked structurally; scalars pass through.
 * @param {unknown} value a raw parsed-capsule value
 * @returns {unknown} the same value with every `{$bigint}` wrapper replaced by its string
 */
export const revive_wire = (value) => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(revive_wire)
  const keys = Object.keys(value)
  if (keys.length === 1 && keys[0] === '$bigint') return String(/** @type {{ $bigint: unknown }} */ (value).$bigint)
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of keys) out[key] = revive_wire(/** @type {Record<string, unknown>} */ (value)[key])
  return out
}

/**
 * A chain event's per-fight ORDER COORDINATE — the one total order the inbox admits and folds by.
 * `version` is the object version the event was emitted at; `ordinal` its position within that version's batch.
 * @typedef {{ version: number, ordinal: number }} EventCoord
 */

/** The string key for a coordinate — the log/courtesy map key (`"<version>:<ordinal>"`). */
export const coord_key = ({ version, ordinal }) => `${version}:${ordinal}`

/** Total order over coordinates: version first, then intra-version ordinal. Returns <0, 0, >0. */
export const coord_cmp = (a, b) => a.version - b.version || a.ordinal - b.ordinal

/** `a` strictly after `b` — the frontier-advance test. */
export const coord_after = (a, b) => coord_cmp(a, b) > 0

/** The lowest possible coordinate — the empty-frontier seed (before any event). */
export const COORD_ZERO = { version: -1, ordinal: -1 }
