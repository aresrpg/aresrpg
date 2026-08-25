// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The check-changes lane over the REAL composers: a changed row must land in the changed
// bucket and compose the exact rewrite door; a dropped row must surface as removed; a
// one-shot supply row must warn instead of pretending a rewrite exists; a board beyond the
// last written index must APPEND while a changed one replaces in place.

import { describe, expect, test } from 'bun:test'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type Pins, type SuiTransport } from '../src/client.ts'
import type { SeedContent } from '../src/seed.ts'
import { board_catalog_id, item_template_id, recipe_id, spell_template_id } from '../src/seed_ids.ts'
import { seed_ledger_after, seed_sync_rows, seed_sync_view, seed_update_transactions } from '../src/seed_sync.ts'

const REGISTRY = `0x${'11'.repeat(32)}`
const PACKAGE = `0x${'22'.repeat(32)}`
const MATH_PACKAGE = `0x${'33'.repeat(32)}`
const ADMIN_CAP = `0x${'44'.repeat(32)}`
const SEED_PACKAGE = '0x5eed'.padEnd(66, '0')
const CONTENT_ROOT = '0xc0'.padEnd(66, '0')
const resolve_transaction: TransactionPlugin = async (_data, _options, next) => next()

const content: SeedContent = {
  items: [
    { item_type: 'ore', name: 'Ore', category: 'resource', level: 1 },
    {
      item_type: 'box',
      name: 'Box',
      category: 'consumable',
      level: 1,
      consumable: { type: 'loot_box', rewards: [{ item_type: 'ore', weight: 1, amount: 5 }] },
    },
  ],
  spells: [
    {
      name: 'spark',
      classe: 'senshi',
      unlock_level: 1,
      levels: [
        {
          ap_cost: 3,
          range_min: 1,
          range_max: 5,
          modifiable_range: true,
          line_of_sight: true,
          line_launch: false,
          free_cell: false,
          casts_per_turn: 2,
          casts_per_target: 1,
          cooldown_turns: 0,
          crit_1_in: 20,
          effects: [],
          crit_effects: [],
        },
      ],
    },
  ],
  mobs: [],
  recipes: [],
  worlds: [],
  shop: { sales: [{ item_type: 'ore', price: 5, supply: 10 }] },
  airdrop: { drops: [], giftcards: [] },
  biome_maps: [],
  boards: [
    {
      width: 9,
      height: 9,
      shape_mask: ['0', '0', '0', '0', '0', '0'],
      obstacles: [],
      holes: [],
      start_cells_a: [0],
      start_cells_b: [80],
    },
    {
      width: 11,
      height: 11,
      shape_mask: ['1', '0', '0', '0', '0', '0'],
      obstacles: [4],
      holes: [],
      start_cells_a: [1],
      start_cells_b: [90],
    },
  ],
}

const armed = () => {
  const sdk = game()
  sdk.cache.owned.set(ADMIN_CAP, { objectId: ADMIN_CAP, version: '1', digest: 'digest' })
  sdk.cache.shared.set(REGISTRY, { initialSharedVersion: '1' })
  return sdk
}

const game = () => {
  const result = SDK({
    address: `0x${'99'.repeat(32)}`,
    pins: {
      package: PACKAGE,
      math_package: MATH_PACKAGE,
      seed_package: SEED_PACKAGE,
      seed_package_original: SEED_PACKAGE,
      content_root: { id: CONTENT_ROOT, shared_version: '1' },
      loot_registry: { id: `0x${'55'.repeat(32)}`, shared_version: '1' },
    } as Pins,
    client: {
      core: {
        resolveTransactionPlugin: () => resolve_transaction,
        getBalance: async () => ({ balance: { balance: '0' } }),
        getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
        getChainIdentifier: async () => ({ chainIdentifier: REGISTRY }),
        getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
        listCoins: async () => ({ objects: [] }),
        getObjects: async () => ({ objects: [] }),
        simulateTransaction: async () => ({}),
        executeTransaction: async () => ({}),
      },
    } as SuiTransport,
  })
  return result
}

const move_call_targets = (tx: Transaction): readonly string[] =>
  tx
    .getData()
    .commands.flatMap((command) => (command.$kind === 'MoveCall' ? [command.MoveCall] : []))
    .map(({ package: pkg, module, function: fn }) => `${pkg}::${module}::${fn}`)

const ore_id = item_template_id(CONTENT_ROOT, SEED_PACKAGE, 'ore')
const box_id = item_template_id(CONTENT_ROOT, SEED_PACKAGE, 'box')
const spark_id = spell_template_id(CONTENT_ROOT, SEED_PACKAGE, 'spark')
const catalog_id = board_catalog_id(CONTENT_ROOT, SEED_PACKAGE)

describe('check changes', () => {
  test('sorts rows into new, changed, removed, up to date, and cannot-rewrite', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const ore = rows.find(({ key }) => key === ore_id)!
    const ledger = {
      [ore_id]: { hash: ore.hash, label: 'item ore' }, // untouched
      [spark_id]: { hash: 'stale', label: 'spell spark' }, // edited in the files
      '0xdead': { hash: 'x', label: 'item old_relic' }, // dropped from the files
      [rows.find(({ label }) => label === 'sale ore')!.key]: { hash: 'stale', label: 'sale ore' },
    }
    // everything except the box exists on chain; boards wait for their catalog
    const exists = (id: string): boolean => id !== box_id && id !== catalog_id

    const view = seed_sync_view(rows, ledger, exists)

    expect(view.new_rows.map(({ label }) => label)).toEqual(['item box', 'board #0', 'board #1'])
    expect(view.changed.map(({ label }) => label)).toEqual(['spell spark', 'sale ore'])
    expect(view.removed).toEqual([{ key: '0xdead', label: 'item old_relic' }])
    expect(view.fixed).toEqual([])
    expect(view.unchanged).toBe(1)
  })

  test('omitting an existing sale retires it instead of leaving the old shop row enabled', () => {
    const sdk = armed()
    const sale = seed_sync_rows(sdk, content).find(({ domain }) => domain === 'sale')!
    sdk.cache.shared.set(sale.key, { initialSharedVersion: '1' })
    const without_sales = seed_sync_rows(sdk, { ...content, shop: { sales: [] } })
    const ledger = {
      [sale.key]: {
        hash: sale.hash,
        label: sale.label,
        domain: 'sale',
        sale: sale.sale,
      },
    }

    const view = seed_sync_view(without_sales, ledger, () => true)
    expect(view.removed).toEqual([])
    const retirements = view.changed.filter(({ domain }) => domain === 'sale')
    expect(retirements.map(({ label }) => label)).toEqual(['retire sale ore'])

    const [tx] = seed_update_transactions(sdk, retirements, {
      admin_cap: ADMIN_CAP,
      content_root: REGISTRY,
    })
    expect(move_call_targets(tx!)).toContain(`${PACKAGE}::shop::set_sale`)
  })

  test('omitting an existing recipe retires its direct craft door', () => {
    const sdk = armed()
    const old_recipe = recipe_id(CONTENT_ROOT, SEED_PACKAGE, 'old_tool')
    sdk.cache.shared.set(old_recipe, { initialSharedVersion: '1' })
    const ledger = {
      [old_recipe]: { hash: 'old', label: 'recipe old_tool', domain: 'recipe' },
    }

    const view = seed_sync_view(seed_sync_rows(sdk, content), ledger, () => true)
    expect(view.removed).toEqual([])
    const retirements = view.changed.filter(({ key }) => key === old_recipe)
    expect(retirements.map(({ label }) => label)).toEqual(['retire recipe old_tool'])

    const [tx] = seed_update_transactions(sdk, retirements, {
      admin_cap: ADMIN_CAP,
      content_root: REGISTRY,
    })
    expect(move_call_targets(tx!)).toContain(`${SEED_PACKAGE}::recipe_rows::retire_recipe`)
  })

  test('a changed row composes its real rewrite doors', () => {
    const sdk = armed()
    sdk.cache.shared.set(box_id, { initialSharedVersion: '1' })
    sdk.cache.shared.set(ore_id, { initialSharedVersion: '1' })
    sdk.cache.shared.set(spark_id, { initialSharedVersion: '1' })
    const rows = seed_sync_rows(sdk, content)
    const changed = rows.filter(({ label }) => label === 'item box' || label === 'spell spark')

    const [tx, ...rest] = seed_update_transactions(sdk, changed, { admin_cap: ADMIN_CAP, content_root: REGISTRY })

    expect(rest).toEqual([])
    const targets = move_call_targets(tx!)
    expect(targets).toContain(`${SEED_PACKAGE}::item_rows::overwrite_item`)
    expect(targets).toContain(`${PACKAGE}::loot_box::clear_loot_table`)
    expect(targets).toContain(`${PACKAGE}::loot_box::add_loot_reward`)
    expect(targets).toContain(`${SEED_PACKAGE}::spell_rows::overwrite_spell`)
  })

  test('a dungeon room edit diffs the world and replaces its complete ordered composition', () => {
    const sdk = armed()
    const world = {
      world: 'nauvis',
      entry_level: 1,
      mobs: [],
      resources: [],
      dungeon: { key: 'ore', rooms: [[{ mob_type: 'ant' }]] },
    } as const
    const previous = seed_sync_rows(sdk, { ...content, worlds: [world] }).find(({ domain }) => domain === 'world')!
    sdk.cache.shared.set(previous.key, { initialSharedVersion: '1' })
    const changed_content = {
      ...content,
      worlds: [{ ...world, dungeon: { ...world.dungeon, rooms: [[{ mob_type: 'boss' }]] } }],
    } satisfies SeedContent
    const rows = seed_sync_rows(sdk, changed_content)
    const view = seed_sync_view(rows, { [previous.key]: { hash: previous.hash, label: previous.label } }, () => true)
    const changed_worlds = view.changed.filter(({ domain }) => domain === 'world')

    expect(changed_worlds.map(({ label }) => label)).toEqual(['world nauvis'])
    const [tx] = seed_update_transactions(sdk, changed_worlds, {
      admin_cap: ADMIN_CAP,
      content_root: REGISTRY,
    })
    const targets = move_call_targets(tx!)
    expect(targets).toContain(`${SEED_PACKAGE}::world_content::set_dungeon_key`)
    expect(targets).toContain(`${SEED_PACKAGE}::world_content::set_dungeon_rooms`)
    expect(targets).toContain(`${MATH_PACKAGE}::world_map::new_dungeon_room`)
    expect(targets).toContain(`${MATH_PACKAGE}::world_map::new_room_mob`)
  })

  test('a board past the last written index appends; a changed one replaces in place', () => {
    const sdk = armed()
    sdk.cache.shared.set(catalog_id, { initialSharedVersion: '1' })
    const rows = seed_sync_rows(sdk, content)
    const boards = rows.filter(({ kind }) => kind === 'board')
    const ledger = { 'board:0': { hash: 'stale', label: 'board #0' } } // board #1 never written

    const [tx] = seed_update_transactions(
      sdk,
      boards,
      { admin_cap: ADMIN_CAP, content_root: REGISTRY },
      { chain_len: 1, authored_len: 2 }
    )

    const targets = move_call_targets(tx!)
    expect(targets.filter((target) => target.endsWith('::board_catalog::replace_board'))).toHaveLength(1)
    expect(targets.filter((target) => target.endsWith('::board_catalog::add_board'))).toHaveLength(1)
  })

  test('a shorter authored collection removes the chain tail', () => {
    const sdk = armed()
    sdk.cache.shared.set(catalog_id, { initialSharedVersion: '1' })

    const transactions = seed_update_transactions(
      sdk,
      [],
      { admin_cap: ADMIN_CAP, content_root: REGISTRY },
      { chain_len: 3, authored_len: 1 }
    )
    const calls = transactions.flatMap(move_call_targets)
    const view = seed_sync_view(seed_sync_rows(sdk, content), {}, () => true, 3)

    expect(calls.filter((target) => target.endsWith('::board_catalog::remove_last_board'))).toHaveLength(2)
    expect(view.board_removals).toEqual([{ key: 'board:2', label: 'board #2' }])
    expect(view.removed).toEqual([])
  })

  test('a written spell keeps its class, ladder slot, and existence — only effects are live', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const spark = rows.find(({ key }) => key === spark_id)!
    const ledger = {
      // spark was written with a DIFFERENT class and ladder slot than the files now say
      [spark_id]: { hash: 'stale', label: 'spell spark', domain: 'spell', spell: { classe: 'yogan', unlock_level: 9 } },
      // and a spell the files no longer carry at all
      '0xgone': { hash: 'x', label: 'spell old_flame', domain: 'spell' },
    }

    const view = seed_sync_view(rows, ledger, () => true)

    expect(view.errors).toHaveLength(3)
    expect(view.errors.some((error) => error.includes("stays in its class's kit forever"))).toBeTrue()
    expect(view.errors.some((error) => error.includes('keeps its class forever'))).toBeTrue()
    expect(view.errors.some((error) => error.includes('keeps its slot on the ladder'))).toBeTrue()
    expect(spark.spell).toEqual({ classe: 'senshi', unlock_level: 1 })
  })

  test('an effects-only spell change carries no errors', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const spark = rows.find(({ key }) => key === spark_id)!
    const ledger = {
      [spark_id]: {
        hash: 'stale',
        label: 'spell spark',
        domain: 'spell',
        spell: { classe: 'senshi', unlock_level: 1 },
      },
    }

    const view = seed_sync_view(rows, ledger, () => true)

    expect(view.changed.map(({ label }) => label)).toContain('spell spark')
    expect(view.errors).toEqual([])
    expect(spark.hash).not.toBe('stale')
  })

  test('the record after an apply covers exactly the rows that now match their files', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const ore = rows.find(({ key }) => key === ore_id)!
    const spark = rows.find(({ key }) => key === spark_id)!
    const ledger = {
      [ore_id]: { hash: ore.hash, label: 'item ore' },
      '0xdead': { hash: 'x', label: 'item old_relic' },
    }

    const next = seed_ledger_after(rows, ledger, new Set([spark.key]), (id) => id === ore_id || id === spark_id)

    expect(next[ore_id]?.hash).toBe(ore.hash) // untouched row carried over
    expect(next[spark_id]?.hash).toBe(spark.hash) // freshly written row recorded
    expect(next[spark_id]?.addresses).toEqual([spark_id])
    expect(next['0xdead']).toBeUndefined() // dropped rows leave with the files
    expect(next[box_id]).toBeUndefined() // never-created rows stay out
  })
})
