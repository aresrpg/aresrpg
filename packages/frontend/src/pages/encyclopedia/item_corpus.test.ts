// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// item_corpus.test.ts — RED-FIRST for the reported defect: every gear picker in the simulator was empty on a
// real deployment. Root cause: the pickers read the BUNDLED seed catalog (`@aresrpg/sdk/items-data`), which is
// `{}` by construction in this repo (the content boundary), instead of the live /v1 corpus the chain serves.
//
// The two things that can silently re-break it are pinned here:
//   1. the empty -> populated transition (a corpus that arrives late must produce rows — the cache law), and
//   2. slot filtering off the RAW Move category, from a fixture that deliberately MIXES item types.

import { describe, expect, test } from 'bun:test'

import { seed_manifest } from '../../content/seed_manifest'
import type { RpcEncyclopediaItem } from '../../rpc/views'
import { items_for_slot } from '../../game/screens/hud/simulator-equip.js'

import { item_corpus_from_v1 } from './item_corpus'

// Fixtures speak REAL seeded template ids so the rows match the shapes /v1 actually serves (no id whitelist
// gates them any more — #1467). Borrow the first few the receipt pins.
const LIVING_IDS = Object.values(seed_manifest.items).filter((id) => typeof id === 'string' && id.startsWith('0x'))

// The /v1 stat projection serves the on-chain StatsMin/MaxKey ranges BIASED at 32768 (a stat is signed, the
// chain field is not), so a fixture has to speak that wire — writing plain 3/9 here would test the decoder
// against itself and pass while the real payload decoded to -32765.
const STAT_BIAS = 32768

const row = (index: number, category: string, over: Partial<RpcEncyclopediaItem> = {}): RpcEncyclopediaItem => ({
  template_id: LIVING_IDS[index],
  item_type: `art_${category}_${index}`,
  name: `${category} ${index}`,
  description: null,
  level: 10 + index,
  category,
  stats: { strength: [STAT_BIAS + 3, STAT_BIAS + 9] },
  damages: [],
  supply: 1,
  last_sale_mist: null,
  ...over,
})

// One row per slot family the paper doll offers, so a filter that leaks shows up as a foreign category.
const MIXED: RpcEncyclopediaItem[] = [
  row(0, 'helmet'),
  row(1, 'chestplate'),
  row(2, 'gauntlets'),
  row(3, 'pants'),
  row(4, 'longsword'),
  row(5, 'bow'),
  row(6, 'ring'),
  row(7, 'relic'),
  row(8, 'boots'),
  row(9, 'amulet'),
]

describe('the corpus comes from /v1, and an empty one is a STATE, never the ceiling', () => {
  test('no corpus yet -> no rows (and no crash): the honest empty every picker starts from', () => {
    expect(item_corpus_from_v1(undefined)).toEqual([])
    expect(item_corpus_from_v1(null)).toEqual([])
    expect(item_corpus_from_v1([])).toEqual([])
    expect(items_for_slot('helmet', item_corpus_from_v1([]))).toEqual([])
  })

  test('the SAME slot populates once the /v1 rows land — the transition the bundled catalog could never make', () => {
    expect(items_for_slot('helmet', item_corpus_from_v1([])).length).toBe(0)
    expect(items_for_slot('helmet', item_corpus_from_v1(MIXED)).length).toBe(1)
  })

  test('a row keeps its authored [min,max] ranges — the max roll is the fold’s job, never resolved here', () => {
    const [item] = item_corpus_from_v1([row(0, 'helmet')])
    expect(item.stats.strength).toEqual([3, 9])
  })

  test('the icon key is the authored art slug, never the template object id (a template id 404s)', () => {
    const [item] = item_corpus_from_v1([row(0, 'helmet')])
    expect(item.item_type).toBe('art_helmet_0')
    expect(item.id).toBe(LIVING_IDS[0])
  })

  // ISSUE #1467 — the corpus used to also drop every row whose template id was absent from the BUILD-TIME
  // seed receipt. The receipt is frozen into the deployed bundle, so a republish that outran a redeploy
  // emptied the corpus wholesale; the live view IS the catalog, and only the developer class is filtered.
  test('a row the deployed bundle never heard of is still live catalog', () => {
    const [item] = item_corpus_from_v1([row(0, 'helmet', { template_id: '0xnot-in-the-bundled-receipt' })])
    expect(item.id).toBe('0xnot-in-the-bundled-receipt')
  })

  test('a developer/cheat template never reaches a build', () => {
    expect(item_corpus_from_v1([row(0, 'developer')])).toEqual([])
  })

  test('rows sort by level then name — the order every item list in the game uses', () => {
    const levels = item_corpus_from_v1(MIXED).map((item) => item.level)
    expect(levels).toEqual([...levels].sort((a, b) => a - b))
  })
})

describe('each slot picker offers ONLY what that slot legally takes', () => {
  const corpus = item_corpus_from_v1(MIXED)

  test.each([
    ['helmet', ['helmet']],
    ['chestplate', ['chestplate']],
    ['gauntlets', ['gauntlets']],
    ['pants', ['pants']],
    ['boots', ['boots']],
    ['amulet', ['amulet']],
  ])('%s offers exactly its own family out of a mixed corpus', (slot, expected) => {
    expect(items_for_slot(slot, corpus).map((item) => item.category)).toEqual(expected)
  })

  test('the weapon slot takes every weapon category, not one hardcoded word', () => {
    expect(
      items_for_slot('weapon', corpus)
        .map((item) => item.category)
        .sort()
    ).toEqual(['bow', 'longsword'])
  })

  test('both ring slots take the one ring family; both are offered the same row', () => {
    expect(items_for_slot('left_ring', corpus).map((item) => item.category)).toEqual(['ring'])
    expect(items_for_slot('right_ring', corpus).map((item) => item.category)).toEqual(['ring'])
  })

  test('every relic slot takes relics', () => {
    for (const slot of ['relic_1', 'relic_3', 'relic_6'])
      expect(items_for_slot(slot, corpus).map((item) => item.category)).toEqual(['relic'])
  })

  // The bug this guards: routing a template through the legacy SDK category bridge collapses the distinct
  // body slots (chestplate->cloak, gauntlets->belt, pants->boots), so a chestplate would surface under cloak.
  test('the distinct body slots never collapse into the cosmetic/belt/boots slots', () => {
    for (const slot of ['cloak', 'belt', 'hat', 'title', 'pet']) expect(items_for_slot(slot, corpus)).toEqual([])
  })
})
