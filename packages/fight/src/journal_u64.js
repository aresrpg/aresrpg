// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/journal_u64.js — the ONE home for u64 discipline in the journal ingress (M2a, #291).
//
// A journal `seq` (contiguous per-fight ordinal) and a fight object `version` are u64 — they can
// exceed `Number.MAX_SAFE_INTEGER` (2^53), where `Number` silently drops low bits and collapses
// distinct ordinals into one (the money/2^53 law that made u64 event fields ride the wire as
// STRINGS). So every ordinal in the ingress lives as a DECIMAL STRING and compares via BigInt;
// `Number()` is NEVER applied to a seq or a version. The normalizer, the paginator and the accept
// machine all pass their ordinals through this door — one home, so no lane re-introduces a coercion.

/**
 * Coerce a wire ordinal (string | number | bigint) to a BigInt, or null when it is not a
 * non-negative integer. A non-safe-integer NUMBER is REFUSED (it has already lost precision before
 * reaching us — the wire must carry large ordinals as strings); a decimal string of any magnitude
 * is lossless. This refusal is the mechanical teeth behind "never Number-coerce a u64".
 * @param {string|number|bigint|null|undefined} value
 * @returns {bigint|null}
 */
export const u64 = (value) => {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return null
}

/**
 * The canonical decimal-string image of a u64 ordinal (null when unparseable) — the shape the ingress
 * stores and re-emits, byte-stable regardless of whether the wire delivered a string or a small number.
 * @param {string|number|bigint|null|undefined} value
 * @returns {string|null}
 */
export const u64_string = (value) => {
  const n = u64(value)
  return n == null ? null : n.toString()
}
