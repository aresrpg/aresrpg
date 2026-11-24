// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The portfolio's bag through the site's real store: one cell per stackable type whatever stack objects the chain
// holds, each account locked by its own listings, every cell in one market group, and every action on a cell
// (listing it, moving it to the other account) reaches every stack of it.
import { afterEach, expect, test } from 'bun:test'
import type { AgentPairingIdentity, ItemRow, ListingRow } from '@aresrpg/protocol'

import { selected_transfer_items } from '../src/agents/inventory_transfer.ts'
import { encumbered_asset_ids } from '../src/inventory_stacks.ts'
import { ITEM_GROUPS } from '../src/marketplace/market_browse.ts'
import { item_listing, sellable_items } from '../src/marketplace/useMarketSell.ts'
import { bag_account, bag_cells, bag_items, in_group } from '../src/portfolio/bag.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { fake_wallet, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))

const row = (id: string, item_type: string, category: string, amount = 1, kiosk = '0xmine'): ItemRow => ({
  id,
  name: item_type,
  item_type,
  category,
  level: 1,
  amount,
  kiosk,
  version: '3',
})
const pairing: AgentPairingIdentity = {
  address: '0xbot',
  multisig_public_key: 'descriptor',
  signer_mode: 'host-persistent',
}
const ids = (rows: readonly Readonly<{ id: string }>[]) => rows.map(({ id }) => id).toSorted()

test('the bag shows one cell per stackable type and every action on a cell reaches each of its stacks', async () => {
  const wallet = fake_wallet({
    read_agent_balances: async () => ({ sui_balance_mist: 0n, kares_balance: null }),
    read_agent_pairing_request: () => ({ zklogin_public_identifier: 'google' }),
  })
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  // The chain holds the shroom powder in four stack objects (one is a listed lot) and the branch in three.
  const shroom = ['0xshroom_a', '0xshroom_b', '0xshroom_c'].map((id, index) =>
    row(id, 'green_mushroom_powder', 'resource', [12, 10, 8][index])
  )
  const lot = row('0xshroom_lot', 'green_mushroom_powder', 'resource', 5)
  const branch = ['0xbranch_a', '0xbranch_b', '0xbranch_c'].map((id, index) =>
    row(id, 'gnawed_branch', 'resource', [15, 10, 5][index])
  )
  const swords = ['0xsword_a', '0xsword_b'].map((id) => row(id, 'gravebrand', 'sword'))
  const crate = row('0xcrate', 'food_crate', 'consumable', 2)
  await sign_in(site, { inventory: [shroom[1]!, lot, ...branch, shroom[0]!, ...swords, crate, shroom[2]!] })
  const listing: ListingRow = { ...item_listing(lot, wallet.address, 500_000_000n), version: '3' }
  site.receive({ type: 'packet/listings', listings: [listing], kiosk_versions: { '0xmine': '3' } })

  const game = bag_account(site.state(), false)
  const cells = bag_cells(game)
  // One cell per stackable type with the total of its unlisted stacks; unique items keep a cell each.
  expect(cells.map(({ item, amount }) => [item.item_type, amount])).toEqual([
    ['green_mushroom_powder', 30],
    ['gnawed_branch', 30],
    ['gravebrand', 1],
    ['gravebrand', 1],
    ['food_crate', 2],
  ])
  expect(ids(cells[0]!.items)).toEqual(ids(shroom))

  // Listing a cell offers the whole amount: the sale form merges the other stacks into the one it lists.
  const encumbered = encumbered_asset_ids(site.state().marketplace.own_listings, site.state().trade.rows)
  const sales = sellable_items(site.state().session.inventory, encumbered)
  for (const cell of cells) {
    const sale = sales.find(({ row, merge_sources }) => [row.id, ...merge_sources].includes(cell.item.id))
    expect(sale && [ids([sale.row, ...sale.merge_sources.map((id) => ({ id }))]), sale.total_amount]).toEqual([
      ids(cell.items),
      cell.amount,
    ])
  }

  // Moving a cell to the bot moves every stack of it and never the listed lot.
  const transferable = bag_items(game).map((item) => ({ item, status: 'available' as const }))
  for (const cell of cells)
    expect(ids(selected_transfer_items(transferable, [cell.item.id])!.map(({ item_id }) => ({ id: item_id })))).toEqual(
      ids(cell.items)
    )

  // The market's groups: every cell falls in exactly one, and no group shows every cell.
  const by_group = ITEM_GROUPS.map((group) => [group, cells.filter(in_group(group)).length])
  expect(by_group).toEqual([
    ['EQUIPMENT', 2],
    ['PETS', 0],
    ['RUNES', 0],
    ['CONSUMABLE', 1],
    ['KEYS', 0],
    ['RESOURCES', 2],
  ])
  expect(cells.filter(in_group(null))).toHaveLength(cells.length)

  // The bot's bag is locked by the bot's own listings, never by the game account's.
  site.dispatch({ type: 'agent/pairing_verified', wallet, pairing })
  site.dispatch({ type: 'agent/inventory_target', wallet, pairing })
  const bot_branch = [row('0xbot_branch_a', 'gnawed_branch', 'resource', 40, '0xbot_kiosk')]
  const bot_lot = row('0xbot_branch_lot', 'gnawed_branch', 'resource', 2, '0xbot_kiosk')
  const observed = (packet: Readonly<Record<string, unknown>>) =>
    site.receive({ type: 'packet/inventory_observed', id: site.state().session.agent_inventory.serial, packet })
  observed({
    type: 'packet/listings',
    listings: [{ ...item_listing(bot_lot, pairing.address, 1n), version: '3' }],
    kiosk_versions: { '0xbot_kiosk': '3' },
  })
  observed({ type: 'packet/inventory', items: [...bot_branch, bot_lot] })
  expect(bag_cells(bag_account(site.state(), true)).map(({ item, amount }) => [item.id, amount])).toEqual([
    ['0xbot_branch_a', 40],
  ])
  expect(bag_cells(bag_account(site.state(), false))).toHaveLength(cells.length)
})
