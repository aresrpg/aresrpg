// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/journal_normalize.js — THE BATCH NORMALIZER (M2a, #291): "receipts and journal pages become
// the same ingress".
//
// Two transports carry the fight's ordered events, and V2 folds them through ONE door:
//   · a JOURNAL PAGE — the M1 read `/v1/fights/{id}/events` (packages/rpc/api/views.js): already the
//     canonical ordered wire, each entry `{ seq, kind, data, digest, version }` (rank-contiguous seq,
//     `data` fullnode-parsedJson-shaped, `digest` the tx digest, `version` the post-tx object version
//     as a STRING | null); and
//   · a TX RECEIPT — the actor's own immediate feedback (the existing store shape
//     `{ events:[{ type, parsedJson }] }`), which carries NO seq: the caller supplies the base seq.
//
// Both normalize to ONE batch shape keyed `(fight_id, seq)`; a normalized event carries
// `{ key, kind, data, digest, version, source }` (+ `fight_id` / `seq` accessors). `kind` is the
// event struct name — the SAME vocabulary `sdk/fight_read.js::decode_fight_event` yields, which
// journal.rs mirrors byte-for-byte — so a receipt event and its journal twin are IDENTICAL content,
// and M2b folds either through the one decoder unchanged.

import { u64, u64_string } from './journal_u64.js'

/** The event struct name = the last `::` segment of the Move type string — the exact rule
 *  `decode_fight_event` keys `kind` on, replayed here without pulling in its field-flattening
 *  (the normalizer keeps `data` in its raw parsedJson shape; decoding is M2b's fold). */
const kind_of_type = (type) =>
  String(type ?? '')
    .split('::')
    .pop() ?? ''

/** Stable, key-sorted JSON image of a value. A receipt's `parsedJson` and the journal's `data` for
 *  one on-chain event carry byte-identical FIELD VALUES (both fullnode-shaped: u64 as string, u32 as
 *  number, bool, id hex), differing at most in key order across the two producers — so a recursively
 *  key-sorted image is representation-stable across the two sources. Numbers ride through
 *  `JSON.stringify` untouched: no ordinal is coerced here. */
const stable_stringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable_stringify).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable_stringify(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value ?? null)
}

/**
 * The CONTENT identity of a normalized event — an FNV-1a digest over its canonical `{ kind, data }`
 * image (the test state_image idiom, packages/fight/test/state_image.js). Source-independent by construction, so
 * a receipt event and its journal twin hash EQUAL: this — never the transport `digest` (a tx digest
 * shared by every event of one tx) — is what the accept machine's IDEMPOTENCE / PROTOCOL-FAULT
 * decision compares.
 * @param {{ kind: string, data: any }} event
 * @returns {string} 8-hex content key
 */
export const content_key = ({ kind, data }) => {
  const text = stable_stringify({ kind, data })
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The `(fight_id, seq)` dedupe key as a stable string (seq normalized to its decimal u64 image). */
export const journal_key = (fight_id, seq) => `${fight_id}:${u64_string(seq)}`

/** Assemble one normalized event. seq/version ride as decimal STRINGS (u64 law); `digest` is pure
 *  provenance (the tx digest), never the content key. */
const normalized_event = ({ fight_id, seq, kind, data, digest, version, source }) => {
  const seq_s = u64_string(seq)
  return {
    key: `${fight_id}:${seq_s}`,
    fight_id,
    seq: seq_s,
    kind,
    data: data ?? {},
    digest: digest ?? null,
    version: version == null ? null : u64_string(version),
    source,
  }
}

/**
 * A JOURNAL PAGE (the M1 `{ fight, events:[{ seq, kind, data, digest, version }], journal_head }`) →
 * the one batch shape. seq/kind/data/digest/version flow straight through (the page is already the
 * canonical ordered wire); `head` = `journal_head` (how far the log currently extends).
 * @param {any} page the M1 read-layer page
 * @param {{ fight_id?: string }} [opts]
 */
export const normalize_journal_page = (page, { fight_id } = {}) => {
  const fid = fight_id ?? page?.fight ?? null
  const events = (page?.events ?? []).map((e) =>
    normalized_event({
      fight_id: fid,
      seq: e.seq,
      kind: e.kind,
      data: e.data,
      digest: e.digest,
      version: e.version,
      source: 'journal',
    })
  )
  // THE CHAIN CLOCK (#2099) — the read layer stamps the live page with the indexer's latest checkpoint
  // timestamp. Carried through as data (never decoded, never re-stamped): the store folds it against the
  // message's own arrival instant into the one per-fight clock offset. Absent (an old server, or an
  // `immutable` past page whose cached timestamp would be a lie) ⇒ null ⇒ no observation, no correction.
  const chain_now = Number(page?.chain_now_ms)
  return {
    fight_id: fid,
    source: 'journal',
    head: u64_string(page?.journal_head),
    events,
    chain_now_ms: chain_now > 0 ? chain_now : null,
  }
}

/** The further of two u64 heads (either may be absent — an unknown head never lowers a known one). */
const further_head = (a, b) => {
  const left = u64(a)
  const right = u64(b)
  if (left == null) return b ?? null
  if (right == null) return a
  return left >= right ? a : b
}

/**
 * Two normalized JOURNAL batches → ONE. The #1382 wire cuts a transaction's event batch into one row per frame;
 * reassembling it is a pure concat over the already-ordered wire plus the further head. Nothing is re-keyed and
 * no ordinal is re-derived: `seq` is chain truth and rides through untouched, so a reassembled batch folds
 * exactly as the single page carrying the same rows would.
 * @param {{ fight_id: any, source: string, head: string|null, events: any[] }} held
 * @param {{ head?: string|null, events?: any[] }} next
 */
export const merge_journal_batches = (held, next) => ({
  ...held,
  head: further_head(held.head, next?.head),
  events: [...held.events, ...(next?.events ?? [])],
})

/**
 * A TX RECEIPT (the existing store shape `{ events:[{ type, parsedJson }] }`, or a bare event array)
 * → the SAME batch shape. The receipt carries no seq — the caller passes `from_seq` (its accept
 * head's next-expected seq) and each event takes `seq = from_seq + i`. Every event of one tx shares
 * that tx's post-`version` and `digest`. This seq assignment is OPTIMISTIC (a peer's tx may have
 * interleaved on chain); the accept machine reconciles against the authoritative journal — prediction
 * corrects forward, it is never trusted over a page.
 * @param {any} receipt `{ events, version?, digest? }` or `[{ type, parsedJson }]`
 * @param {{ fight_id?: string, from_seq?: string|number|bigint, version?: any, digest?: any }} [opts]
 */
export const normalize_receipt = (receipt, { fight_id = null, from_seq = 0, version = null, digest = null } = {}) => {
  const raw = Array.isArray(receipt) ? receipt : (receipt?.events ?? [])
  const base = u64(from_seq) ?? 0n
  const version_v = version ?? receipt?.version ?? null
  const digest_v = digest ?? receipt?.digest ?? null
  const events = raw.map((e, i) =>
    normalized_event({
      fight_id,
      seq: (base + BigInt(i)).toString(),
      kind: kind_of_type(e?.type ?? e?.parsedType),
      data: e?.parsedJson ?? e?.json ?? e?.data ?? {},
      digest: digest_v,
      version: version_v,
      source: 'receipt',
    })
  )
  return { fight_id, source: 'receipt', head: null, events }
}
