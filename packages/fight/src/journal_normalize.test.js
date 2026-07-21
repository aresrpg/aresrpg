// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE BATCH NORMALIZER (M2a, #291) — receipts and journal pages become the SAME ingress. Proven
// against a REAL M1 page fixture and a receipt of the same on-chain event.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { content_key, journal_key, normalize_journal_page, normalize_receipt } from './journal_normalize.js'

const load = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../test/fixtures/journal/${name}`, import.meta.url)), 'utf8'))
const PAGE_0 = load('page_0.json')
const PAGE_HEAD = load('page_head.json')
const FIGHT = '0xf1647' // house-synthetic id (chain-id gate) — matches the fixtures' synthetic fight id

describe('normalizer — journal page', () => {
  test('an M1 page becomes the batch shape, seq/version as u64 strings, data+digest pass through', () => {
    const b = normalize_journal_page(PAGE_0)
    expect(b.source).toBe('journal')
    expect(b.fight_id).toBe(FIGHT)
    expect(b.head).toBe('5')
    expect(b.events.map((e) => e.seq)).toEqual(['0', '1', '2'])
    const created = b.events.at(0)
    expect(created).toEqual({
      key: `${FIGHT}:0`,
      fight_id: FIGHT,
      seq: '0',
      kind: 'FightCreated',
      data: PAGE_0.events[0].data, // untouched (raw parsedJson shape — decoding is M2b)
      digest: '9Xr4Qh2kW1vB7tZaCe', // provenance (tx digest), carried, never the content key
      version: '348000010',
      source: 'journal',
    })
    // the >2^63 u64 field inside `data` survived as a string (never Number-coerced).
    expect(created.data.spawn_id).toBe('12475479364079269131')
  })
})

describe('normalizer — tx receipt', () => {
  // the existing store receipt shape: { events: [{ type, parsedJson }] }, one tx → one version + digest.
  const receipt = {
    version: '348000013',
    digest: '5Hd7Wq3xTb8kM2vNpF',
    events: [
      {
        type: `0xpkg::fight_events::Displaced`,
        parsedJson: PAGE_HEAD.events[0].data,
      },
      {
        type: `0xpkg::fight_events::Hit`,
        // SAME Hit fields as journal seq 4 but a DIFFERENT key order — the normalizer keeps data raw.
        parsedJson: { remaining_hp: '10', fight: FIGHT, amount: '7', victim_idx: '0', victim_is_mob: true },
      },
    ],
  }

  test('a receipt takes the caller-supplied base seq, kind from the type tail, one shared version+digest', () => {
    const b = normalize_receipt(receipt, { fight_id: FIGHT, from_seq: '3' })
    expect(b.source).toBe('receipt')
    expect(b.events.map((e) => e.seq)).toEqual(['3', '4']) // from_seq + i
    expect(b.events.map((e) => e.kind)).toEqual(['Displaced', 'Hit'])
    expect(b.events.every((e) => e.version === '348000013')).toBe(true) // one tx → one object version
    expect(b.events.every((e) => e.digest === '5Hd7Wq3xTb8kM2vNpF')).toBe(true) // shared tx digest
    expect(b.events[1].key).toBe(journal_key(FIGHT, 4))
  })

  test('a bare event array + parsedType fallback still normalizes', () => {
    const b = normalize_receipt(
      [{ parsedType: 'a::fight_events::TurnEnded', parsedJson: { fight: FIGHT, is_mob: false, idx: '0' } }],
      {
        fight_id: FIGHT,
        from_seq: '9',
      }
    )
    expect(b.events[0]).toMatchObject({ seq: '9', kind: 'TurnEnded', source: 'receipt' })
  })
})

describe('normalizer — one ingress', () => {
  test('a receipt event and its JOURNAL twin hash to the SAME content_key (key order irrelevant)', () => {
    const journal_hit = normalize_journal_page(PAGE_HEAD).events.at(1) // seq 4, Hit
    const receipt_hit = normalize_receipt(
      {
        events: [
          {
            type: 'x::fight_events::Hit',
            parsedJson: { remaining_hp: '10', fight: FIGHT, amount: '7', victim_idx: '0', victim_is_mob: true },
          },
        ],
      },
      { fight_id: FIGHT, from_seq: '4' }
    ).events.at(0)
    expect(receipt_hit.source).not.toBe(journal_hit.source) // genuinely two transports
    expect(content_key(receipt_hit)).toBe(content_key(journal_hit)) // ...one content identity
  })

  test('a DIFFERENT field value produces a DIFFERENT content_key (the fault signal)', () => {
    const a = normalize_journal_page(PAGE_HEAD).events.at(1)
    const b = normalize_receipt(
      {
        events: [
          {
            type: 'x::fight_events::Hit',
            parsedJson: { fight: FIGHT, victim_is_mob: true, victim_idx: '0', amount: '7', remaining_hp: '9' },
          },
        ],
      },
      { fight_id: FIGHT, from_seq: '4' }
    ).events.at(0)
    expect(content_key(a)).not.toBe(content_key(b))
  })
})
