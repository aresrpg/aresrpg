#!/usr/bin/env bun
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE STANDBY PARITY PREDICATE — the machine gate the blue/green flip runbook asks before it
// moves the /v1 pointer (#1109, teeth ③ and ⑤).
//
// WHY IT EXISTS (2026-07-27): the standby stack was green, healthy and fully caught up — and held
// the PREVIOUS era's twelve package ids. Every liveness signal said "flip me"; a flip would have
// served the wrong world. Health is not identity, and "caught up" is not "caught up on the right
// chain state", so eligibility is measured, never eyeballed:
//
//   tooth ③  package-set   — the standby indexer's ARES_PACKAGES set EQUALS the serving one
//                            (set semantics: order-, duplicate- and spelling-independent, every
//                            id canonicalized to 0x + 64 lowercase hex).
//   tooth ⑤  watermark-tip — every standby pipeline watermark is within `tolerance` checkpoints
//                            of the live chain tip. Measured against the chain, never timed.
//
// Exit codes:
//   0  FLIP-ELIGIBLE
//   1  a tooth failed — one named-reason line per failed tooth on stderr
//   2  the predicate could not be evaluated (missing config, unreachable store, unreadable tip).
//      Same operational meaning as 1 (do not flip), different cause — mirrors the release-pin
//      gate's convention: 1 = the world disagrees, 2 = the world could not be read.
//
// Usage (all inputs are env — the flip runbook exports them from the two live deployments):
//
//   PARITY_SERVING_PACKAGES=0x…,0x…      the SERVING indexer's ARES_PACKAGES, verbatim
//   PARITY_STANDBY_PACKAGES=0x…,0x…      the STANDBY indexer's ARES_PACKAGES, verbatim
//   PARITY_STANDBY_REDIS_URL=redis://…   the STANDBY store (read-only: JSON.GET on watermarks)
//   PARITY_TIP_TOLERANCE=60              optional — max checkpoints the standby may trail the tip
//   PARITY_PIPELINES=checkpoints,ares,ares_snapshot   optional — pipelines that must be at tip
//   PARITY_FULLNODE_URL=https://…        optional — gRPC-Web LedgerService/GetServiceInfo endpoint
//
//   bun packages/rpc/scripts/standby_parity.mjs
//
// Allowlists are indexer PROCESS config (clap `--ares-packages` / `ARES_PACKAGES`), not store
// state, so both sides are supplied by the caller reading the two deployments. Nothing here
// writes: the predicate is a read of two stores' truth plus one chain read.
//
// Tip source: the Mysten fullnode's JSON-RPC route 404s (verified again 2026-07-27; README note
// dates it to 2026-07-08), and the RPC-provider law forbids third-party mirrors — so the tip comes
// from the official fullnode's gRPC v2 LedgerService over gRPC-Web, which is plain HTTPS POST and
// needs no gRPC dependency. The 30-line frame/varint decode below is vendored on purpose (a
// dependency is a marriage) and pinned against real captured bytes in standby_parity.test.js.

import { RedisClient } from 'bun'

// --- pure core ---------------------------------------------------------------------------------

/** Max checkpoints a standby may trail the chain tip. Sui testnet was measured at 4.28
 *  checkpoints/s on 2026-07-27 (137 checkpoints over 32s, official fullnode), so 60 is ~14
 *  seconds — comfortably "streaming live at tip" for a healthy indexer that commits in batches,
 *  and orders of magnitude short of any replay still in progress. Tighten with
 *  PARITY_TIP_TOLERANCE when the flip window justifies it. */
export const DEFAULT_TIP_TOLERANCE = 60

/** Every pipeline the indexer registers (indexer/src/main.rs). A flip on a stack whose snapshot
 *  pipeline still trails serves stale character profiles, so all three must be at tip. */
export const DEFAULT_PIPELINES = ['checkpoints', 'ares', 'ares_snapshot']

const ADDRESS_HEX = /^[0-9a-f]{1,64}$/
const CHECKPOINT_HEIGHT_FIELD = 4 // GetServiceInfoResponse.checkpoint_height (proto3 varint)
const MAX_LISTED_IDS = 4

/** A Sui package id in its one canonical spelling: 0x + 64 lowercase hex. Null when the input is
 *  not an address at all — callers report those instead of silently dropping them. */
export function canonical_package_id(raw) {
  if (typeof raw !== 'string') return null
  const lowered = raw.trim().toLowerCase()
  const hex = lowered.startsWith('0x') ? lowered.slice(2) : lowered
  if (!ADDRESS_HEX.test(hex)) return null
  return `0x${hex.padStart(64, '0')}`
}

/** An ARES_PACKAGES string → its canonical id SET (sorted, deduped) plus whatever failed to parse. */
export function parse_package_set(raw) {
  const entries =
    typeof raw === 'string'
      ? raw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : []
  const decoded = entries.map((entry) => ({ entry, id: canonical_package_id(entry) }))
  return {
    ids: [...new Set(decoded.filter((row) => row.id !== null).map((row) => row.id))].sort(),
    invalid: decoded.filter((row) => row.id === null).map((row) => row.entry),
  }
}

/** Set comparison of two ARES_PACKAGES strings. `equal` is pure set equality — emptiness and
 *  unparseable ids are reported here and judged by evaluate_parity. */
export function compare_package_sets(serving_raw, standby_raw) {
  const serving = parse_package_set(serving_raw)
  const standby = parse_package_set(standby_raw)
  const only_serving = serving.ids.filter((id) => !standby.ids.includes(id))
  const only_standby = standby.ids.filter((id) => !serving.ids.includes(id))
  return {
    serving: serving.ids,
    standby: standby.ids,
    only_serving,
    only_standby,
    invalid_serving: serving.invalid,
    invalid_standby: standby.invalid,
    equal: only_serving.length === 0 && only_standby.length === 0,
  }
}

const list_ids = (ids) =>
  ids.length <= MAX_LISTED_IDS
    ? ids.join(' ')
    : `${ids.slice(0, MAX_LISTED_IDS).join(' ')} …+${ids.length - MAX_LISTED_IDS} more`

/** Tooth ③ — the standby indexes the same era as the stack it would replace. */
function check_package_parity(serving_raw, standby_raw) {
  const comparison = compare_package_sets(serving_raw, standby_raw)
  const named = { tooth: 3, name: 'package-set', comparison }
  const { invalid_serving, invalid_standby, only_serving, only_standby } = comparison

  if (invalid_serving.length > 0 || invalid_standby.length > 0)
    return {
      ...named,
      ok: false,
      reason:
        'unparseable package id(s) — ' +
        `serving: [${invalid_serving.join(' ')}], standby: [${invalid_standby.join(' ')}]`,
    }

  if (comparison.serving.length === 0 || comparison.standby.length === 0)
    return {
      ...named,
      ok: false,
      reason:
        'the ARES_PACKAGES allowlist is empty or unset on ' +
        `${comparison.serving.length === 0 ? 'serving' : 'standby'} — an unbounded (unset) or ` +
        'allow-nothing (empty) indexer can never be proven at era parity',
    }

  if (!comparison.equal)
    return {
      ...named,
      ok: false,
      reason:
        "the standby indexer's ARES_PACKAGES set ≠ the serving one — " +
        `${only_serving.length} only on serving (${list_ids(only_serving)}), ` +
        `${only_standby.length} only on standby (${list_ids(only_standby)})`,
    }

  return { ...named, ok: true }
}

/** Tooth ⑤ — the standby has actually replayed to the chain tip, on every pipeline. */
function check_watermark_parity(watermarks, chain_tip, tolerance) {
  const named = { tooth: 5, name: 'watermark-tip' }
  if (!Number.isFinite(chain_tip) || chain_tip <= 0)
    return { ...named, ok: false, reason: `chain tip unavailable (got ${chain_tip})` }

  const rows = Object.entries(watermarks ?? {}).map(([pipeline, raw]) => ({
    pipeline,
    checkpoint: Number.isFinite(Number(raw)) && raw !== null ? Number(raw) : null,
  }))
  if (rows.length === 0) return { ...named, ok: false, reason: 'no watermark read from the standby store' }

  const missing = rows.filter((row) => row.checkpoint === null)
  const lagging = rows.filter((row) => row.checkpoint !== null && chain_tip - row.checkpoint > tolerance)
  if (missing.length === 0 && lagging.length === 0) return { ...named, ok: true, rows }

  const reasons = [
    ...missing.map((row) => `${row.pipeline}: no watermark on the standby store`),
    ...lagging.map(
      (row) =>
        `${row.pipeline} is ${chain_tip - row.checkpoint} checkpoints behind chain tip ` +
        `${chain_tip} (tolerance ${tolerance})`
    ),
  ]
  return { ...named, ok: false, rows, reason: reasons.join('; ') }
}

/** The predicate. Both teeth are always evaluated, so one run names every reason a flip is unsafe. */
export function evaluate_parity({
  serving_packages,
  standby_packages,
  watermarks,
  chain_tip,
  tolerance = DEFAULT_TIP_TOLERANCE,
}) {
  const checks = [
    check_package_parity(serving_packages, standby_packages),
    check_watermark_parity(watermarks, chain_tip, tolerance),
  ]
  return { eligible: checks.every((check) => check.ok), checks }
}

/** A `JSON.GET key $` reply → the pipeline's committed checkpoint, or null when it is absent or
 *  malformed. Redis answers a JSONPath with an array of matches (mirrors api/redis.js). */
export function parse_watermark_reply(raw) {
  if (raw == null) return null
  const parsed = decode_json(raw)
  const doc = Array.isArray(parsed) ? parsed[0] : parsed
  if (doc === null || typeof doc !== 'object') return null
  const checkpoint = Number(doc.checkpoint_hi_inclusive)
  return Number.isFinite(checkpoint) ? checkpoint : null
}

function decode_json(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// --- gRPC-Web / protobuf decode (vendored, pinned against captured bytes in the test) -----------

/** Base-128 varint at `offset`. Returns { value, next } or null on truncation/overflow. */
function read_varint(bytes, offset, shift = 0, acc = 0) {
  if (offset >= bytes.length || shift > 63) return null
  const byte = bytes[offset]
  const accumulated = acc + (byte & 0x7f) * 2 ** shift
  if ((byte & 0x80) !== 0) return read_varint(bytes, offset + 1, shift + 7, accumulated)
  return Number.isSafeInteger(accumulated) ? { value: accumulated, next: offset + 1 } : null
}

/** First varint-typed field `field_number` in a proto3 message, skipping every other field. */
function scan_varint_field(bytes, field_number, offset = 0) {
  if (offset >= bytes.length) return null
  const key = read_varint(bytes, offset)
  if (key === null) return null
  const wire_type = key.value & 0x07
  const field = Math.floor(key.value / 8)

  if (wire_type === 0) {
    const payload = read_varint(bytes, key.next)
    if (payload === null) return null
    return field === field_number ? payload.value : scan_varint_field(bytes, field_number, payload.next)
  }
  if (wire_type === 2) {
    const length = read_varint(bytes, key.next)
    if (length === null) return null
    return scan_varint_field(bytes, field_number, length.next + length.value)
  }
  if (wire_type === 5) return scan_varint_field(bytes, field_number, key.next + 4)
  if (wire_type === 1) return scan_varint_field(bytes, field_number, key.next + 8)
  return null // groups — never emitted by proto3
}

/** First DATA frame of a gRPC-Web body ([flags][len:u32be][payload]); trailer frames (0x80) skipped. */
function first_data_frame(bytes, offset = 0) {
  if (offset + 5 > bytes.length) return null
  const length =
    ((bytes[offset + 1] << 24) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 8) | bytes[offset + 4]) >>> 0
  const start = offset + 5
  const end = start + length
  if (end > bytes.length) return null
  if ((bytes[offset] & 0x80) === 0) return bytes.subarray(start, end)
  return first_data_frame(bytes, end)
}

/** A gRPC-Web GetServiceInfo response body → the fullnode's checkpoint height, or null. */
export function decode_service_info_checkpoint_height(bytes) {
  const message = first_data_frame(bytes)
  if (message === null) return null
  return scan_varint_field(message, CHECKPOINT_HEIGHT_FIELD)
}

// --- effects (the edge) -------------------------------------------------------------------------

const DEFAULT_FULLNODE_URL = 'https://fullnode.testnet.sui.io/sui.rpc.v2.LedgerService/GetServiceInfo'
const EMPTY_GRPC_FRAME = new Uint8Array([0, 0, 0, 0, 0])

async function read_chain_tip(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
    body: EMPTY_GRPC_FRAME,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GetServiceInfo returned HTTP ${response.status}`)
  const tip = decode_service_info_checkpoint_height(new Uint8Array(await response.arrayBuffer()))
  if (tip === null) throw new Error('GetServiceInfo body carried no checkpoint height')
  return tip
}

async function read_watermarks(redis_url, pipelines) {
  const client = new RedisClient(redis_url)
  try {
    const replies = await Promise.all(
      pipelines.map((pipeline) => client.send('JSON.GET', [`rpc:watermark:${pipeline}`, '$']))
    )
    return Object.fromEntries(pipelines.map((pipeline, index) => [pipeline, parse_watermark_reply(replies[index])]))
  } finally {
    client.close()
  }
}

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} is not set — see the usage header of this script`)
  return value
}

if (import.meta.main) {
  const { env } = process
  console.log('== standby parity predicate (#1109 teeth ③ package-set + ⑤ watermark-tip) ==')

  const tolerance = Number(env.PARITY_TIP_TOLERANCE ?? DEFAULT_TIP_TOLERANCE)
  const pipelines = (env.PARITY_PIPELINES ?? DEFAULT_PIPELINES.join(','))
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  const inputs = await (async () => {
    try {
      const serving_packages = required(env, 'PARITY_SERVING_PACKAGES')
      const standby_packages = required(env, 'PARITY_STANDBY_PACKAGES')
      const redis_url = required(env, 'PARITY_STANDBY_REDIS_URL')
      if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error(`PARITY_TIP_TOLERANCE is not a count`)
      const [chain_tip, watermarks] = await Promise.all([
        read_chain_tip(env.PARITY_FULLNODE_URL ?? DEFAULT_FULLNODE_URL),
        read_watermarks(redis_url, pipelines),
      ])
      return { serving_packages, standby_packages, chain_tip, watermarks }
    } catch (error) {
      console.error(`CANNOT EVALUATE — ${error.message}`)
      return null
    }
  })()

  if (inputs === null) process.exit(2)

  const result = evaluate_parity({ ...inputs, tolerance })
  console.log(`   chain tip          : ${inputs.chain_tip}`)
  console.log(
    `   standby watermarks : ${pipelines.map((name) => `${name}=${inputs.watermarks[name] ?? 'absent'}`).join(' ')}`
  )
  console.log(
    `   package ids        : serving ${parse_package_set(inputs.serving_packages).ids.length}, ` +
      `standby ${parse_package_set(inputs.standby_packages).ids.length}`
  )
  result.checks.forEach((check) => {
    if (check.ok) console.log(`  ok  tooth-${check.tooth} ${check.name}`)
    else console.error(`FAIL tooth-${check.tooth} ${check.name}: ${check.reason}`)
  })

  if (result.eligible) {
    console.log('FLIP-ELIGIBLE — the standby indexes the current era and has replayed to tip.')
    process.exit(0)
  }
  console.error('NOT FLIP-ELIGIBLE — do not move the /v1 pointer.')
  process.exit(1)
}
