// Pure-function tests for the encyclopedia loot mapping (loot.ts) — the two design laws made executable:
//   1. EXACT CHANCE — the on-chain basis-point chance (served by /v1 as `chance_percent`) is carried through
//      VERBATIM and never rounded (a 0.10% drop stays 0.10%, never collapses to 0%).
//   2. NO FABRICATION / EXISTENCE — the loot table is a pure projection of the /v1 rows; nothing is added from a
//      static seed catalog, so a template absent from the mob's on-chain drops can never render ("if it's in the
//      encyclopedia, it's provably in game").
// No React, no RPC — exercised against the real mapping, not a mock.
//
// Run with: bun test packages/frontend/src/pages/encyclopedia/loot.test.ts

import { describe, test, expect } from 'bun:test'

import type { RpcMobDrop } from '../../rpc/views'

import { v1_drops_to_display } from './loot'

const row = (over: Partial<RpcMobDrop>): RpcMobDrop => ({
  template_id: '0x' + '1'.repeat(64),
  name: 'Sickle',
  category: 'resource',
  chance_percent: 2,
  min_qty: 1,
  max_qty: 1,
  ...over,
})

describe('v1_drops_to_display — exact chance (never rounded)', () => {
  test('a fractional chance (2.5%) is carried through verbatim, NOT rounded to 3', () => {
    const [d] = v1_drops_to_display([row({ chance_percent: 2.5 })])
    expect(d.chance_percent).toBe(2.5)
    expect(d.chance_percent.toFixed(2)).toBe('2.50')
  })

  test('a sub-1% chance (0.10%, i.e. 10 bp) stays 0.1 and NEVER collapses to 0', () => {
    const [d] = v1_drops_to_display([row({ chance_percent: 0.1 })])
    expect(d.chance_percent).toBe(0.1)
    expect(d.chance_percent.toFixed(2)).toBe('0.10')
    // the bar-fill width is clamped for layout, but the source-of-truth number is NOT the rounded bar
    expect(d.drop_weight).toBe(0.1)
  })

  test('drop_weight (bar width) is clamped to 100 but the chance itself is untouched', () => {
    const [d] = v1_drops_to_display([row({ chance_percent: 100 })])
    expect(d.drop_weight).toBe(100)
    expect(d.chance_percent).toBe(100)
  })

  test('rows are sorted best-chance-first', () => {
    const out = v1_drops_to_display([
      row({ template_id: '0xaaa', chance_percent: 2 }),
      row({ template_id: '0xbbb', chance_percent: 60 }),
      row({ template_id: '0xccc', chance_percent: 5 }),
    ])
    expect(out.map((d) => d.chance_percent)).toEqual([60, 5, 2])
  })
})

describe('v1_drops_to_display — no fabrication / existence guarantee', () => {
  test('the loot table is EXACTLY the /v1 rows — no catalog augmentation', () => {
    const out = v1_drops_to_display([row({ template_id: '0xdead' })])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('0xdead')
  })

  test('a mob with no on-chain drops renders an EMPTY table (never a seed-catalog guess)', () => {
    expect(v1_drops_to_display([])).toEqual([])
  })

  test('an item still awaiting its object snapshot shows a short id, never a fabricated name', () => {
    const id = '0x' + 'ab'.repeat(32)
    const [d] = v1_drops_to_display([row({ template_id: id, name: null })])
    expect(d.name).toBe(`${id.slice(0, 6)}…${id.slice(-4)}`)
  })
})
