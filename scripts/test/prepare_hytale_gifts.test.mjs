// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

import {
  append_hytale_gifts,
  hytale_gift_batches,
  hytale_supporters,
  rank_hytale_players,
} from '../prepare_hytale_gifts.mjs'

const address = (n) => `0x${n.toString(16).padStart(64, '0')}`
const snapshot = () => ({
  schema: 1,
  source: { sha256: 'a'.repeat(64), snapshot_ms: 1000 },
  players: [
    { player_id: 'a', name: 'A', role: 'DEFAULT', address: address(1), time_played_ms: 100, sui_spent_cents: 10_000 },
    { player_id: 'b', name: 'B', role: 'DEFAULT', address: address(2), time_played_ms: 200, sui_spent_cents: 10_001 },
    {
      player_id: 'staff',
      name: 'Staff',
      role: 'ADMIN',
      address: address(3),
      time_played_ms: 9999,
      sui_spent_cents: 20_000,
    },
  ],
  characters: [
    { player_id: 'a', character_id: 'a1', experience: 100, jobs: '{"MINER":{"xp":50,"runeXp":0}}' },
    { player_id: 'a', character_id: 'a2', experience: 200, jobs: '{}', craft_xp: 140 },
    { player_id: 'b', character_id: 'b1', experience: 1, jobs: null },
  ],
  inventory: [
    { player_id: 'a', item_id: 'sword', item_type: 'sword', quantity: 1 },
    { player_id: 'b', item_id: 'wheat', item_type: 'wheat', quantity: 100000 },
  ],
  bank: [
    { player_id: 'a', item_id: 'sword', item_type: 'sword', quantity: 1 },
    { player_id: 'a', item_id: 'hat', item_type: 'hat', quantity: 1 },
  ],
})

test('ranking aggregates characters and bank equipment without rewarding stack duplication or privileged accounts', () => {
  const data = snapshot()
  const ranking = rank_hytale_players(data, 2)
  expect(ranking.candidates).toBe(2)
  expect(ranking.excluded).toHaveLength(1)
  expect(ranking.players[0]).toMatchObject({
    address: address(1),
    character_xp: 300,
    profession_levels: 3,
    unique_item_types: 2,
    item_quantity: 2,
  })
  expect(
    rank_hytale_players(
      { ...data, players: [...data.players].reverse(), characters: [...data.characters].reverse() },
      2
    )
  ).toEqual(ranking)
  expect(() => rank_hytale_players(data)).toThrow('cannot select 100')
})

test('one linked wallet can receive only one ranking position across multiple accounts', () => {
  const data = snapshot()
  data.players[1].address = address(1)
  expect(rank_hytale_players(data, 1).players).toHaveLength(1)
  expect(rank_hytale_players(data, 1).players[0].time_played_ms).toBe(300)
})

test('the three authored tiers deliver 160 of each crate across exactly 100 wallets', async () => {
  const content = JSON.parse(await readFile(new URL('../../seed/content/airdrop.json', import.meta.url), 'utf8'))
  const campaign = content.campaigns.find(({ id }) => id === 'hytale_veterans')
  const ranking = {
    players: Array.from({ length: 100 }, (_, index) => ({ rank: index + 1, address: address(index + 1) })),
  }
  const batches = hytale_gift_batches(campaign, ranking)
  expect(batches).toHaveLength(12)
  for (const item_type of campaign.items) {
    const rows = batches.filter((row) => row.item_type === item_type)
    expect(rows.map((row) => [row.recipients.length, row.amount])).toEqual([
      [10, 3],
      [40, 2],
      [50, 1],
    ])
    expect(rows.reduce((sum, row) => sum + row.recipients.length * row.amount, 0)).toBe(160)
  }
})

test('spending eligibility is strictly above 100 SUI and independent of the ranking staff exclusion', () => {
  expect(hytale_supporters(snapshot(), 100)).toEqual([
    { address: address(3), spent_sui: 200 },
    { address: address(2), spent_sui: 100.01 },
  ])
})

test('prepared allocations are idempotent and cannot silently change a recipient or tier', () => {
  const batches = [{ id: 'hytale_veterans_1_10_pet_crate', amount: 3, recipients: [address(1)] }]
  const first = append_hytale_gifts({ giftcard_batches: [] }, batches)
  expect(append_hytale_gifts(first, batches)).toBe(first)
  expect(() => append_hytale_gifts(first, [{ ...batches[0], amount: 2 }])).toThrow('frozen')
  expect(() => append_hytale_gifts(first, [{ ...batches[0], recipients: [address(2)] }])).toThrow('frozen')
})
