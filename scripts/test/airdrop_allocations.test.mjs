// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFile } from 'node:fs/promises'

import { expect, test } from 'bun:test'

test('the additional test vouchers fund five recipes for each basic tool without reusing claimed identities', async () => {
  const content = JSON.parse(await readFile(new URL('../../seed/content/airdrop.json', import.meta.url), 'utf8'))
  const recipes = JSON.parse(await readFile(new URL('../../seed/content/recipes.json', import.meta.url), 'utf8'))
  const tools = ['basic_pickaxe', 'old_hoe', 'tool_herbalist']
  const selected = recipes.filter(({ output_type }) => tools.includes(output_type))
  expect(selected).toHaveLength(3)
  const required = {}
  for (const recipe of selected)
    for (const [item_type, amount] of Object.entries(recipe.inputs))
      required[item_type] = (required[item_type] ?? 0) + amount * 5
  const additions = content.giftcards.filter(({ id }) => id.startsWith('test_20260909_tools_5_'))
  expect(Object.fromEntries(additions.map(({ item_type, amount }) => [item_type, amount]))).toEqual(required)
  expect(
    additions.every(
      ({ network, campaign, custody }) =>
        network === 'testnet' &&
        campaign === 'temporary_test' &&
        custody === '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7'
    )
  ).toBeTrue()
  expect(new Set(content.giftcards.map(({ id }) => id)).size).toBe(content.giftcards.length)
  expect(content.giftcards.filter(({ id }) => id.startsWith('test_20260908_'))).toHaveLength(4)
})
