// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// U64 DISCIPLINE (M2a, #291) — property tests proving seq/version handling stays lossless ABOVE
// Number.MAX_SAFE_INTEGER (2^53), the exact regime where Number() collapses distinct ordinals into
// one. The proof spans the helpers AND the accept machine's lane refusal — no ordinal is ever
// Number-coerced anywhere in the ingress.

import { describe, expect, test } from 'bun:test'

import { u64, u64_string } from './journal_u64.js'
import { normalize_journal_page } from './journal_normalize.js'
import { accept_batch, seed_accept_state } from './journal_accept.js'

const FIGHT = '0xf1647' // house-synthetic id (chain-id gate)
const TWO_53 = 9_007_199_254_740_992n // Number.MAX_SAFE_INTEGER + 1

// bases straddling and far beyond 2^53, up to near the u64 ceiling.
const BIG_BASES = [
  TWO_53,
  TWO_53 + 1n,
  1_152_921_504_606_846_976n /* 2^60 */,
  18_446_744_073_709_551_516n /* 2^64-100 */,
]

/** A journal page of `count` events at contiguous huge seqs from `base` (seqs + versions as strings). */
const big_page = (base, count) => ({
  fight: FIGHT,
  journal_head: (base + BigInt(count)).toString(),
  events: Array.from({ length: count }, (_, i) => ({
    seq: (base + BigInt(i)).toString(),
    kind: 'Hit',
    data: { fight: FIGHT, victim_is_mob: true, victim_idx: String(i), amount: '7', remaining_hp: '10' },
    digest: `tx-${i}`,
    version: (base + BigInt(i)).toString(),
  })),
})

describe('u64 — helpers', () => {
  test('a decimal string of any magnitude round-trips losslessly', () => {
    for (const base of BIG_BASES) {
      expect(u64(base.toString())).toBe(base)
      expect(u64_string(base.toString())).toBe(base.toString())
    }
  })

  test('adjacent ordinals above 2^53 stay DISTINCT (where Number() collapses them)', () => {
    const a = '9007199254740993' // 2^53 + 1
    const b = '9007199254740992' // 2^53
    expect(Number(a)).toBe(Number(b)) // the trap: Number makes them equal
    expect(u64(a)).not.toBe(u64(b)) // ...BigInt keeps them apart
  })

  test('a non-safe-integer NUMBER is refused (it already lost bits); a huge string is accepted', () => {
    expect(u64(Number.MAX_SAFE_INTEGER + 1)).toBe(null) // past the safe bound a Number is already lossy
    expect(u64('9007199254740993')).toBe(9_007_199_254_740_993n)
    expect(u64(-1)).toBe(null)
    expect(u64('nope')).toBe(null)
  })
})

describe('u64 — the accept machine refuses the courtesy lane without Number coercion', () => {
  test('protocol faults preserve the exact seq at every base beyond 2^53', () => {
    for (const base of BIG_BASES) {
      const seeded = seed_accept_state(base.toString())
      expect(seeded.head).toBe((base - 1n).toString())

      const refused = accept_batch(seeded, normalize_journal_page(big_page(base, 3)))
      const fault = refused.effects.find((e) => e.type === 'protocol_fault')
      expect(fault).toMatchObject({ type: 'protocol_fault', fight_id: FIGHT, seq: base.toString(), accepted: null })
      expect(fault.received).toEqual(expect.any(String))
      expect(refused.state).toEqual(seeded)
      expect(refused.effects.some((e) => e.type === 'apply')).toBe(false)
    }
  })

  test('a version far above 2^53 survives normalization as an exact string', () => {
    const b = normalize_journal_page(big_page(TWO_53 + 7n, 1))
    expect(b.events[0].version).toBe((TWO_53 + 7n).toString())
    expect(b.events[0].seq).toBe((TWO_53 + 7n).toString())
  })
})
