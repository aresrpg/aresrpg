// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit suite for the STANDBY PARITY PREDICATE (#1109 teeth ③ + ⑤).
//
// Run targeted: `bun test scripts/standby_parity.test.js` from packages/rpc
// (NEVER a bare `bun test` in packages/rpc — see gas-pool/generate-config.test.js).
//
// NO NETWORK: every input here is a frozen fixture. The one wire-format check pins REAL captured
// bytes with provenance (the gRPC-Web GetServiceInfo frame below), per docs/CODE_LAW.md's
// "decode tests assert captured wire bytes" law — a decoder tested only against its own encoder
// proves nothing.
import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_TIP_TOLERANCE,
  canonical_package_id,
  compare_package_sets,
  decode_service_info_checkpoint_height,
  evaluate_parity,
  parse_watermark_reply,
} from './standby_parity.mjs'

// --- THE NEAR-MISS FIXTURE (2026-07-27) --------------------------------------------------------
// The standby stack was healthy, caught up, and held the PREVIOUS era's package allowlist — a blind
// flip would have served the wrong world. What made it dangerous is reproduced exactly here: TWELVE
// ids on each side with ZERO overlap, so anything counting ids waves it through and only set
// equality catches it.
//
// The eras are SYNTHESIZED, not copied off the chain: hand-typed live package ids are banned in
// source (scripts/check-chain-ids.mjs — they rot at the next republish and read as live wiring),
// and identity is irrelevant to this predicate — cardinality and overlap are the whole property.
// Short-hex spellings double as canonicalization coverage.
const era_packages = (prefix) =>
  Array.from({ length: 12 }, (_, index) => `0x${prefix}${(index + 1).toString(16).padStart(2, '0')}`)
const CURRENT_ERA = era_packages('c0de')
const PREVIOUS_ERA = era_packages('01d0')

const CHAIN_TIP = 364687995
const at_tip = (checkpoint = CHAIN_TIP) => ({
  checkpoints: checkpoint,
  ares: checkpoint,
  ares_snapshot: checkpoint,
})

const tooth = (result, number) => result.checks.find((check) => check.tooth === number)

describe('canonical package-id normalization', () => {
  test('pads, lowercases and 0x-prefixes every legal spelling of the same id', () => {
    const kiosk = `0x${'0'.repeat(63)}2` // the native kiosk package, spelled in full
    expect(canonical_package_id('0x2')).toBe(kiosk)
    expect(canonical_package_id('2')).toBe(kiosk)
    expect(canonical_package_id('  0X2  ')).toBe(kiosk)
    expect(canonical_package_id(kiosk)).toBe(kiosk)
    expect(canonical_package_id(CURRENT_ERA[0].toUpperCase())).toBe(canonical_package_id(CURRENT_ERA[0]))
  })

  test('rejects anything that is not a Sui address', () => {
    expect(canonical_package_id('')).toBeNull()
    expect(canonical_package_id('0x')).toBeNull()
    expect(canonical_package_id('0xzz')).toBeNull()
    expect(canonical_package_id(`0x${'f'.repeat(65)}`)).toBeNull() // one nibble too wide
    expect(canonical_package_id(null)).toBeNull()
  })
})

describe('package-set comparison is set semantics, not string equality', () => {
  test('order, duplicates, spacing and short-hex spelling never move the verdict', () => {
    const shuffled = [...CURRENT_ERA].reverse().join(' , ')
    // …plus the same id three more ways: repeated, upper-cased, and spelled out to 64 nibbles
    const with_dupes = `${shuffled},${CURRENT_ERA[3]},${CURRENT_ERA[0].toUpperCase()},${canonical_package_id(CURRENT_ERA[7])}`
    expect(compare_package_sets(CURRENT_ERA.join(','), with_dupes).equal).toBe(true)
  })

  test('names both directions of a mismatch', () => {
    const missing_one = CURRENT_ERA.slice(1).join(',')
    const comparison = compare_package_sets(CURRENT_ERA.join(','), `${missing_one},0x9`)
    expect(comparison.equal).toBe(false)
    expect(comparison.only_serving).toEqual([canonical_package_id(CURRENT_ERA[0])])
    expect(comparison.only_standby).toEqual([canonical_package_id('0x9')])
  })

  test('collects unparseable ids per side instead of silently dropping them', () => {
    const comparison = compare_package_sets(`${CURRENT_ERA[0]},0xzz`, CURRENT_ERA[0])
    expect(comparison.invalid_serving).toEqual(['0xzz'])
    expect(comparison.invalid_standby).toEqual([])
  })
})

describe('THE NEAR-MISS — a stale-era standby is never flip-eligible (#1109 tooth ③)', () => {
  test('the fixture defeats a cardinality check: 12 ids on both sides, zero overlap', () => {
    expect(CURRENT_ERA).toHaveLength(12)
    expect(PREVIOUS_ERA).toHaveLength(12)
    expect(CURRENT_ERA.filter((id) => PREVIOUS_ERA.includes(id))).toEqual([])
  })

  test('a caught-up standby on the previous era FAILS parity', () => {
    const result = evaluate_parity({
      serving_packages: CURRENT_ERA.join(','),
      standby_packages: PREVIOUS_ERA.join(','),
      watermarks: at_tip(),
      chain_tip: CHAIN_TIP,
      tolerance: DEFAULT_TIP_TOLERANCE,
    })

    expect(result.eligible).toBe(false)
    expect(tooth(result, 3).ok).toBe(false)
    expect(tooth(result, 3).reason).toContain('12 only on serving')
    expect(tooth(result, 3).reason).toContain('12 only on standby')
    // tooth ⑤ is independently green — the standby WAS caught up, which is exactly why the
    // completeness gate alone would have waved the wrong world through.
    expect(tooth(result, 5).ok).toBe(true)
  })
})

describe('flip eligibility', () => {
  test('matching era + watermarks at tip = FLIP-ELIGIBLE', () => {
    const result = evaluate_parity({
      serving_packages: CURRENT_ERA.join(','),
      standby_packages: [...CURRENT_ERA].reverse().join(', '),
      watermarks: at_tip(),
      chain_tip: CHAIN_TIP,
      tolerance: DEFAULT_TIP_TOLERANCE,
    })
    expect(result.eligible).toBe(true)
    expect(result.checks.every((check) => check.ok)).toBe(true)
  })

  test('an empty or unset allowlist on either side is never parity', () => {
    const base = { watermarks: at_tip(), chain_tip: CHAIN_TIP, tolerance: DEFAULT_TIP_TOLERANCE }
    const both_empty = evaluate_parity({ ...base, serving_packages: '', standby_packages: '' })
    expect(both_empty.eligible).toBe(false)
    expect(tooth(both_empty, 3).reason).toContain('empty')

    const standby_unset = evaluate_parity({
      ...base,
      serving_packages: CURRENT_ERA.join(','),
      standby_packages: undefined,
    })
    expect(tooth(standby_unset, 3).ok).toBe(false)
  })
})

describe('watermark-vs-tip completeness (#1109 tooth ⑤)', () => {
  const matching = {
    serving_packages: CURRENT_ERA.join(','),
    standby_packages: CURRENT_ERA.join(','),
    chain_tip: CHAIN_TIP,
    tolerance: DEFAULT_TIP_TOLERANCE,
  }

  test('a standby mid-replay fails with its measured lag named', () => {
    const result = evaluate_parity({ ...matching, watermarks: at_tip(CHAIN_TIP - 687868) })
    expect(result.eligible).toBe(false)
    expect(tooth(result, 5).ok).toBe(false)
    expect(tooth(result, 5).reason).toContain('687868 checkpoints behind')
  })

  test('lag inside the tolerance passes; one checkpoint past it does not', () => {
    expect(evaluate_parity({ ...matching, watermarks: at_tip(CHAIN_TIP - DEFAULT_TIP_TOLERANCE) }).eligible).toBe(true)
    expect(evaluate_parity({ ...matching, watermarks: at_tip(CHAIN_TIP - DEFAULT_TIP_TOLERANCE - 1) }).eligible).toBe(
      false
    )
  })

  test('a single lagging pipeline sinks the flip even when the others are at tip', () => {
    const result = evaluate_parity({
      ...matching,
      watermarks: { ...at_tip(), ares_snapshot: CHAIN_TIP - 5000 },
    })
    expect(tooth(result, 5).ok).toBe(false)
    expect(tooth(result, 5).reason).toContain('ares_snapshot')
    expect(tooth(result, 5).reason).not.toContain('ares ')
  })

  test('a missing watermark is a failure, never an assumed-fine', () => {
    const result = evaluate_parity({ ...matching, watermarks: { ...at_tip(), ares: null } })
    expect(tooth(result, 5).ok).toBe(false)
    expect(tooth(result, 5).reason).toContain('no watermark')
  })

  test('a standby reading ahead of a stale tip snapshot is not a failure', () => {
    expect(evaluate_parity({ ...matching, watermarks: at_tip(CHAIN_TIP + 40) }).eligible).toBe(true)
  })

  test('both teeth can fail at once, each with its own named reason', () => {
    const result = evaluate_parity({
      serving_packages: CURRENT_ERA.join(','),
      standby_packages: PREVIOUS_ERA.join(','),
      watermarks: at_tip(CHAIN_TIP - 999),
      chain_tip: CHAIN_TIP,
      tolerance: DEFAULT_TIP_TOLERANCE,
    })
    expect(result.checks.filter((check) => !check.ok)).toHaveLength(2)
  })
})

describe('watermark document parsing (rpc:watermark:{pipeline})', () => {
  const doc = { checkpoint_hi_inclusive: 364687995, epoch_hi_inclusive: 1172, tx_hi: 42, timestamp_ms_hi_inclusive: 1 }

  test('unwraps the JSONPath match array Redis returns for JSON.GET key $', () => {
    expect(parse_watermark_reply(JSON.stringify([doc]))).toBe(364687995)
  })

  test('accepts a bare document and a numeric string, rejects everything else', () => {
    expect(parse_watermark_reply(JSON.stringify(doc))).toBe(364687995)
    expect(parse_watermark_reply(JSON.stringify([{ ...doc, checkpoint_hi_inclusive: '364687995' }]))).toBe(364687995)
    expect(parse_watermark_reply(null)).toBeNull()
    expect(parse_watermark_reply('[]')).toBeNull()
    expect(parse_watermark_reply('not json')).toBeNull()
    expect(parse_watermark_reply(JSON.stringify([{ epoch_hi_inclusive: 1172 }]))).toBeNull()
  })
})

describe('chain tip decode — CAPTURED WIRE BYTES', () => {
  // Real response body, byte for byte, from:
  //   curl -X POST https://fullnode.testnet.sui.io/sui.rpc.v2.LedgerService/GetServiceInfo \
  //     -H 'content-type: application/grpc-web+proto' --data-binary <5-byte empty gRPC frame>
  // captured 2026-07-27 (chain testnet, epoch 1172, sui-node/1.76.0-9cd34734d1c4). The Mysten
  // fullnode's JSON-RPC route 404s (README note, 2026-07-08), so gRPC-Web is the tip source.
  const CAPTURED_FRAME =
    '00000000770a2c3639576950673344415169776478666e6358367759513273694b774165364c39425a7468516561334a4e4d44120774657374' +
    '6e657418940920fbe4f2ad012a0b08e1d599d3061080d1ca0830a08befac0138a08befac01421c7375692d6e6f64652f312e37362e302d3963' +
    '64333437333464316334800000000f677270632d7374617475733a300d0a'
  const bytes = (hex) => Uint8Array.from(hex.match(/../g).map((pair) => parseInt(pair, 16)))

  test('reads checkpointHeight out of the real GetServiceInfo frame', () => {
    expect(decode_service_info_checkpoint_height(bytes(CAPTURED_FRAME))).toBe(364687995)
  })

  test('returns null rather than a wrong number on truncated or empty bodies', () => {
    expect(decode_service_info_checkpoint_height(bytes(CAPTURED_FRAME).slice(0, 12))).toBeNull()
    expect(decode_service_info_checkpoint_height(new Uint8Array(0))).toBeNull()
    // trailers-only frame (flags bit 0x80) carries no message
    expect(decode_service_info_checkpoint_height(bytes('800000000f677270632d7374617475733a300d0a'))).toBeNull()
  })
})
