// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The check-changes lane over the REAL composers: a changed row must land in the changed
// bucket and compose the exact rewrite door; a dropped row must surface as removed; a
// one-shot supply row must warn instead of pretending a rewrite exists; a board beyond the
// last written index must APPEND while a changed one replaces in place.

import { describe, expect, test } from 'bun:test'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type Pins, type SuiTransport } from '../src/client.ts'
import { create_seed_plan, type SeedContent } from '../src/seed.ts'
import { board_catalog_id, item_template_id, recipe_id, spell_template_id } from '../src/seed_ids.ts'
import {
  canonical_json,
  created_seed_row_keys,
  seed_ledger_after,
  seed_ledger_after_batch,
  seed_sync_rows,
  seed_sync_view,
  type SeedSyncRow,
} from '../src/seed_sync.ts'
import { seed_update_batches } from '../src/seed_updates.ts'

test('creation ledger advances only rows targeted by the certified batch', () => {
  const rows = [
    { key: 'old', kind: 'template', addresses: ['0xold'] },
    { key: 'created', kind: 'template', addresses: ['0xcreated'] },
  ] as never

  expect(created_seed_row_keys(rows, {}, new Set(['0xcreated']), () => true)).toEqual(new Set(['created']))
})

test('content fingerprints ignore JSON object key order', () => {
  expect(canonical_json({ z: 1, nested: { b: 2, a: 1 }, rows: [{ y: 2, x: 1 }] })).toBe(
    canonical_json({ rows: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 })
  )
})

test('a newer chain revision invalidates a matching mutable ledger fingerprint', () => {
  const row = {
    key: '0xrow',
    label: 'world nauvis',
    hash: 'authored',
    kind: 'template',
    domain: 'world',
    chain_id: '0xrow',
    addresses: ['0xrow'],
    hydrate: [],
    cost: 1,
  } as SeedSyncRow
  const ledger = {
    '0xrow': { hash: row.hash, label: row.label, addresses: row.addresses, revisions: { '0xrow': '7:old' } },
  }

  const view = seed_sync_view(
    [row],
    ledger,
    () => true,
    0,
    () => '8:new'
  )
  expect(view.changed).toEqual([row])
  expect(view.unchanged).toBe(0)
})

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
  dungeons: [],
  worlds: [],
  mastery: { offers: [] },
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

test('creation planning and reconciliation own the same derived address set', () => {
  const sdk = game()
  const planned = new Set(create_seed_plan(sdk, content).batches.flatMap(({ target_ids }) => target_ids))
  const reconciled = new Set(seed_sync_rows(sdk, content).flatMap(({ addresses }) => addresses))
  expect([...planned].toSorted()).toEqual([...reconciled].toSorted())
})

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
        waitForTransaction: async () => ({}),
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
  test('a published dungeon slug cannot be removed or renamed', () => {
    const view = seed_sync_view(
      [],
      {
        '0xdungeon': Object.freeze({ hash: 'old', label: 'dungeon keep', domain: 'dungeon' }),
      },
      () => true
    )

    expect(view.errors).toEqual([
      'dungeon keep was removed or renamed, but a published dungeon keeps its stable slug forever — restore the row and edit its rooms instead',
    ])
  })

  test('a published city slug cannot be removed or renamed', () => {
    const row = Object.freeze({
      key: '0xworld',
      label: 'world nauvis',
      hash: 'new',
      kind: 'template' as const,
      domain: 'world' as const,
      world: Object.freeze({ cities: Object.freeze(['new_thebes']) }),
      chain_id: '0xworld',
      addresses: Object.freeze(['0xworld']),
      hydrate: Object.freeze([]),
      cost: 1,
    }) satisfies SeedSyncRow
    const view = seed_sync_view(
      [row],
      {
        '0xworld': Object.freeze({
          hash: 'old',
          label: 'world nauvis',
          domain: 'world',
          world: Object.freeze({ cities: Object.freeze(['thebes']) }),
        }),
      },
      () => true
    )
    expect(view.errors).toEqual([
      'world nauvis removed or renamed stable city thebes — restore it and edit its mutable fields instead',
    ])
  })

  test('sorts rows into new, changed, removed, up to date, and cannot-rewrite', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const ore = rows.find(({ key }) => key === ore_id)!
    const ledger = {
      [ore_id]: { hash: ore.hash, label: 'item ore' }, // untouched
      [spark_id]: { hash: 'stale', label: 'spell spark' }, // edited in the files
      '0xdead': { hash: 'x', label: 'item old_relic' }, // dropped from the files
    }
    // everything except the box exists on chain; boards wait for their catalog
    const exists = (id: string): boolean => id !== box_id && id !== catalog_id

    const view = seed_sync_view(rows, ledger, exists)

    expect(view.new_rows.map(({ label }) => label)).toEqual(['item box', 'board #0', 'board #1'])
    expect(view.changed.map(({ label }) => label)).toEqual(['item ore', 'spell spark'])
    expect(view.removed).toEqual([{ key: '0xdead', label: 'item old_relic' }])
    expect(view.fixed).toEqual([])
    expect(view.unchanged).toBe(0)
  })

  test('omitting an existing mastery offer disables its point-mint door', () => {
    const sdk = armed()
    const with_offer = { ...content, mastery: { offers: [{ item_type: 'box', cost: 5 }] } }
    const offer = seed_sync_rows(sdk, with_offer).find(({ domain }) => domain === 'mastery_offer')!
    sdk.cache.shared.set(offer.key, { initialSharedVersion: '1' })
    const rows = seed_sync_rows(sdk, content)
    const view = seed_sync_view(
      rows,
      { [offer.key]: { hash: offer.hash, label: offer.label, domain: 'mastery_offer' } },
      () => true
    )
    const [retirement] = view.changed.filter(({ domain }) => domain === 'mastery_offer')
    expect(retirement?.label).toBe('retire mastery offer box')
    const [batch] = seed_update_batches(sdk, [retirement!], { admin_cap: ADMIN_CAP, content_root: REGISTRY })
    expect(move_call_targets(batch!.transaction)).toContain(`${PACKAGE}::mastery::set_offer`)
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

    const [batch] = seed_update_batches(sdk, retirements, {
      admin_cap: ADMIN_CAP,
      content_root: REGISTRY,
    })
    expect(move_call_targets(batch!.transaction)).toContain(`${SEED_PACKAGE}::recipe_rows::retire_recipe`)
  })

  test('a changed row composes its real rewrite doors', () => {
    const sdk = armed()
    sdk.cache.shared.set(box_id, { initialSharedVersion: '1' })
    sdk.cache.shared.set(ore_id, { initialSharedVersion: '1' })
    sdk.cache.shared.set(spark_id, { initialSharedVersion: '1' })
    const rows = seed_sync_rows(sdk, content)
    const changed = rows.filter(({ label }) => label === 'item box' || label === 'spell spark')

    const [batch, ...rest] = seed_update_batches(sdk, changed, { admin_cap: ADMIN_CAP, content_root: REGISTRY })

    expect(rest).toEqual([])
    const targets = move_call_targets(batch!.transaction)
    expect(batch!.written).toEqual(changed.map(({ key }) => key))
    expect(targets).toContain(`${SEED_PACKAGE}::item_rows::overwrite_item`)
    expect(targets).toContain(`${PACKAGE}::loot_box::clear_loot_table`)
    expect(targets).toContain(`${PACKAGE}::loot_box::add_loot_reward`)
    expect(targets).toContain(`${SEED_PACKAGE}::spell_rows::overwrite_spell`)
  })

  test('a dungeon room edit rewrites its independent content without touching the world', () => {
    const sdk = armed()
    const dungeon = {
      dungeon: 'keep',
      key: 'ore',
      rooms: [[{ mob_type: 'ant' }]],
    } as const
    const previous = seed_sync_rows(sdk, { ...content, dungeons: [dungeon] }).find(
      ({ domain }) => domain === 'dungeon'
    )!
    sdk.cache.shared.set(previous.key, { initialSharedVersion: '1' })
    const changed_content = {
      ...content,
      dungeons: [{ ...dungeon, rooms: [[{ mob_type: 'boss' }]] }],
    } satisfies SeedContent
    const rows = seed_sync_rows(sdk, changed_content)
    const view = seed_sync_view(rows, { [previous.key]: { hash: previous.hash, label: previous.label } }, () => true)
    const changed_dungeons = view.changed.filter(({ domain }) => domain === 'dungeon')

    expect(changed_dungeons.map(({ label }) => label)).toEqual(['dungeon keep'])
    const [batch] = seed_update_batches(sdk, changed_dungeons, {
      admin_cap: ADMIN_CAP,
      content_root: REGISTRY,
    })
    const targets = move_call_targets(batch!.transaction)
    expect(targets).toContain(`${SEED_PACKAGE}::dungeon_content::overwrite`)
    expect(targets).toContain(`${MATH_PACKAGE}::dungeon_data::new_room`)
    expect(targets).toContain(`${MATH_PACKAGE}::dungeon_data::new_room_mob`)
  })

  test('a board past the last written index appends; a changed one replaces in place', () => {
    const sdk = armed()
    sdk.cache.shared.set(catalog_id, { initialSharedVersion: '1' })
    const rows = seed_sync_rows(sdk, content)
    const boards = rows.filter(({ kind }) => kind === 'board')
    const ledger = { 'board:0': { hash: 'stale', label: 'board #0' } } // board #1 never written

    const [batch] = seed_update_batches(
      sdk,
      boards,
      { admin_cap: ADMIN_CAP, content_root: REGISTRY },
      { chain_len: 1, authored_len: 2 }
    )

    const targets = move_call_targets(batch!.transaction)
    expect(targets.filter((target) => target.endsWith('::board_catalog::replace_board'))).toHaveLength(1)
    expect(targets.filter((target) => target.endsWith('::board_catalog::add_board'))).toHaveLength(1)
  })

  test('a shorter authored collection removes the chain tail', () => {
    const sdk = armed()
    sdk.cache.shared.set(catalog_id, { initialSharedVersion: '1' })

    const batches = seed_update_batches(
      sdk,
      [],
      { admin_cap: ADMIN_CAP, content_root: REGISTRY },
      { chain_len: 3, authored_len: 1 }
    )
    const calls = batches.flatMap(({ transaction }) => move_call_targets(transaction))
    const view = seed_sync_view(seed_sync_rows(sdk, content), {}, () => true, 3)

    expect(calls.filter((target) => target.endsWith('::board_catalog::remove_last_board'))).toHaveLength(2)
    expect(batches.at(-1)?.written).toEqual(['board:1', 'board:2'])
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

  test('one certified update advances only its own ledger rows', () => {
    const sdk = game()
    const rows = seed_sync_rows(sdk, content)
    const ore = rows.find(({ key }) => key === ore_id)!
    const spark = rows.find(({ key }) => key === spark_id)!
    const ledger = {
      [ore.key]: { hash: 'old', label: ore.label },
      [spark.key]: { hash: 'old', label: spark.label },
      retired: { hash: 'old', label: 'sale retired', domain: 'sale' },
    }

    const after_ore = seed_ledger_after_batch(rows, ledger, [ore.key])
    const after_retirement = seed_ledger_after_batch(rows, after_ore, ['retired'])

    expect(after_ore[ore.key]?.hash).toBe(ore.hash)
    expect(after_ore[spark.key]?.hash).toBe('old')
    expect(after_retirement.retired).toBeUndefined()
  })
})
