// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { class_names, class_spell_unlocks } from '@aresrpg/immutable'
import type { TransactionPlugin } from '@mysten/sui/transactions'

import type { Receipt } from '../src/cache.ts'
import { SDK, type Pins, type SuiTransport } from '../src/client.ts'
import type { SeedContent } from '../src/seed.ts'
import { board_catalog_id, item_template_id, spell_template_id } from '../src/seed_ids.ts'
import {
  apply_seed_update_batches,
  create_seed_admin,
  create_seed_session_authorization_transaction,
  next_seed_batch,
  project_temp_admin_cap,
  SEED_SESSION_GAS,
  verify_upgrade_cap_targets,
  type SeedApplyProgress,
} from '../src/seed_admin.ts'
import { seed_sync_rows } from '../src/seed_sync.ts'
import type { SeedUpdateBatch } from '../src/seed_updates.ts'

const object_id = (value: number): string => `0x${value.toString(16).padStart(2, '0').repeat(32)}`
const package_id = object_id(1)
const registry_id = object_id(2)
const admin_cap_id = object_id(3)
const content_root_id = object_id(10)
const seed_package_id = '0x5eed'.padEnd(66, '0')
const pinned_content_root_id = '0xc0'.padEnd(66, '0')
const pins: Pins = {
  package: package_id,
  math_package: object_id(4),
  control_package: object_id(5),
  template_registry: { id: registry_id, shared_version: '1' },
  seed_package: seed_package_id,
  seed_package_original: seed_package_id,
  content_root: { id: pinned_content_root_id, shared_version: '1' },
  loot_registry: { id: object_id(5), shared_version: '1' },
}
const content: SeedContent = {
  items: [{ item_type: 'ore', name: 'Ore', category: 'resource', level: 1 }],
  spells: [],
  mobs: [],
  recipes: [],
  dungeons: [],
  worlds: [],
  mastery: { offers: [] },
  airdrop: { drops: [], giftcards: [] },
  biome_maps: [],
  boards: [],
}
const resolve_transaction: TransactionPlugin = async (transaction_data, options, next) => {
  if (!options.onlyTransactionKind) {
    transaction_data.gasData.price ??= '1'
    transaction_data.gasData.budget ??= '200000000'
    transaction_data.gasData.payment ??= [
      { objectId: object_id(50), version: '1', digest: '11111111111111111111111111111111' },
    ]
  }
  await next()
}

const sdk_with = (
  existing: ReadonlySet<string>,
  json_by_id: Readonly<Record<string, unknown>> = {},
  behavior: Readonly<{
    before_objects?: (ids: readonly string[]) => void
    execute?: () => unknown
  }> = {}
) =>
  SDK({
    address: object_id(9),
    pins,
    sign_transaction: async () => ({ bytes: '', signature: '' }),
    client: {
      core: {
        resolveTransactionPlugin: () => resolve_transaction,
        getBalance: async () => ({ balance: { balance: '0' } }),
        getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
        getChainIdentifier: async () => ({ chainIdentifier: object_id(0) }),
        getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
        listCoins: async () => ({ objects: [] }),
        getObjects: async ({ objectIds }) => ({
          objects: (behavior.before_objects?.(objectIds), objectIds)
            .filter((id) => existing.has(id))
            .map((object_id_value) => ({
              objectId: object_id_value,
              version: '1',
              digest: '11111111111111111111111111111111',
              owner: { AddressOwner: object_id(9) },
              json: json_by_id[object_id_value],
            })),
        }),
        simulateTransaction: async () => ({}),
        executeTransaction: async () => behavior.execute?.() ?? {},
        waitForTransaction: async () => ({}),
      },
    } as SuiTransport,
  })

describe('seed admin progress', () => {
  test('mutable updates checkpoint each certified receipt before executing the next batch', async () => {
    const sdk = sdk_with(new Set())
    const [row] = seed_sync_rows(sdk, content)
    const batches: readonly SeedUpdateBatch[] = [
      Object.freeze({ transaction: sdk.tx(), written: Object.freeze([row!.key]) }),
      Object.freeze({ transaction: sdk.tx(), written: Object.freeze(['retired']) }),
    ]
    const checkpoints: SeedApplyProgress[] = []
    const pending: (readonly string[])[] = []
    let executions = 0

    await expect(
      apply_seed_update_batches(
        batches,
        [row!],
        { [row!.key]: { hash: 'old', label: row!.label }, retired: { hash: 'old', label: 'sale retired' } },
        async () => {
          executions += 1
          if (executions === 2) throw new Error('second transaction failed')
          return 'FIRST_DIGEST'
        },
        {
          before_execute: async (written) => {
            pending.push(written)
          },
          checkpoint: async (progress) => {
            checkpoints.push(progress)
          },
        }
      )
    ).rejects.toThrow('second transaction failed')

    expect(executions).toBe(2)
    expect(pending).toHaveLength(2)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.digest).toBe('FIRST_DIGEST')
    expect(checkpoints[0]?.ledger[row!.key]?.hash).toBe(row!.hash)
    expect(checkpoints[0]?.ledger.retired).toBeDefined()
  })

  test('authorizes the local signer and funds it in one wallet transaction', () => {
    const sdk = sdk_with(new Set())
    sdk.cache.owned.set(admin_cap_id, {
      objectId: admin_cap_id,
      version: '1',
      digest: '11111111111111111111111111111111',
    })
    const transaction = create_seed_session_authorization_transaction({
      sdk,
      admin_cap: admin_cap_id,
      recipient: object_id(8),
    })

    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual([
      'MoveCall',
      'MoveCall',
      'SplitCoins',
      'TransferObjects',
    ])
    expect(SEED_SESSION_GAS).toBe(50_000_000_000n)
  })

  test('temporary delegation accepts a smaller bounded working balance', () => {
    const sdk = sdk_with(new Set())
    sdk.cache.owned.set(admin_cap_id, {
      objectId: admin_cap_id,
      version: '1',
      digest: '11111111111111111111111111111111',
    })
    const transaction = create_seed_session_authorization_transaction({
      sdk,
      admin_cap: admin_cap_id,
      recipient: object_id(8),
      funding_mist: 100_000_000n,
    })
    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual([
      'MoveCall',
      'MoveCall',
      'SplitCoins',
      'TransferObjects',
    ])
    expect(() =>
      create_seed_session_authorization_transaction({
        sdk,
        admin_cap: admin_cap_id,
        recipient: object_id(8),
        funding_mist: SEED_SESSION_GAS + 1n,
      })
    ).toThrow('between 1 MIST')
  })

  test('projects the temporary AdminCap exact ref from its authorization receipt', () => {
    const created = object_id(12)
    const receipt: Receipt = {
      Transaction: {
        objectTypes: { [created]: `${package_id}::admin::AdminCap` },
        effects: {
          changedObjects: [
            {
              objectId: created,
              idOperation: 'Created',
              outputVersion: '42',
              outputDigest: 'receipt-digest',
              outputOwner: { AddressOwner: object_id(8) },
            },
          ],
        },
      },
    }

    expect(project_temp_admin_cap(receipt)).toEqual({
      objectId: created,
      version: '42',
      digest: 'receipt-digest',
    })
  })

  test('a published target hidden by the read node stops after one convergence read', async () => {
    const spells = class_names.flatMap((classe) =>
      class_spell_unlocks.map((unlock_level, index) => ({
        name: `${classe}_${index}`,
        classe,
        unlock_level,
        levels: [],
      }))
    )
    const board = Object.freeze({
      width: 2,
      height: 1,
      shape_mask: Object.freeze(['3']),
      obstacles: Object.freeze([]),
      holes: Object.freeze([]),
      start_cells_a: Object.freeze([0]),
      start_cells_b: Object.freeze([1]),
    })
    const catalog = board_catalog_id(pinned_content_root_id, seed_package_id)
    const existing = new Set([
      admin_cap_id,
      content_root_id,
      item_template_id(pinned_content_root_id, seed_package_id, 'ore'),
      ...spells.map(({ name }) => spell_template_id(pinned_content_root_id, seed_package_id, name)),
    ])
    let published = false
    let post_publish_reads = 0
    let executions = 0
    const sdk = sdk_with(
      existing,
      {},
      {
        before_objects: (ids) => {
          if (!published || !ids.includes(catalog)) return
          post_publish_reads += 1
          if (post_publish_reads >= 2) existing.add(catalog)
        },
        execute: () => {
          published = true
          executions += 1
          return {
            $kind: 'Transaction',
            Transaction: {
              digest: 'CATALOG_CREATED',
              effects: { status: { success: true, error: null }, changedObjects: [] },
            },
          }
        },
      }
    )
    const session = await create_seed_admin({
      sdk,
      content: { ...content, spells, boards: [board] },
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })

    await expect(session.execute('boards:catalog', {})).rejects.toThrow(
      /published · CATALOG_CREATED.*Do not republish it/u
    )

    expect(executions).toBe(1)
    expect(post_publish_reads).toBe(1)
  })

  test('creation batches refuse immutable identity errors from the current lineage ledger', async () => {
    const spells = class_names.flatMap((classe) =>
      class_spell_unlocks.map((unlock_level, index) => ({
        name: `${classe}_${index}`,
        classe,
        unlock_level,
        levels: [],
      }))
    )
    let executions = 0
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([admin_cap_id, content_root_id]), {}, { execute: () => (executions += 1) }),
      content: { ...content, spells },
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })
    const next = next_seed_batch(await session.refresh())

    const incompatible_ledger = {
      legacy: { hash: 'old', label: 'spell Legacy Name', domain: 'spell' as const },
    }
    await expect(session.execute(next!.id, incompatible_ledger)).rejects.toThrow(
      'spell Legacy Name was removed from the files'
    )
    await expect(
      session.apply_changes(incompatible_ledger, {
        before_execute: async () => undefined,
        checkpoint: async () => undefined,
      })
    ).rejects.toThrow('spell Legacy Name was removed from the files')
    expect(executions).toBe(0)
  })

  test('the permanent freeze verifies five distinct caps against their active packages', async () => {
    const caps = [object_id(20), object_id(21), object_id(22), object_id(23), object_id(24)]
    const packages = [object_id(30), object_id(31), object_id(32), object_id(33), object_id(34)]
    const sdk = sdk_with(
      new Set(caps),
      Object.freeze(Object.fromEntries(caps.map((cap, index) => [cap, { package: packages[index] }])))
    )
    const targets = caps.map((cap, index) => ({ cap, package: packages[index]! }))

    expect(await verify_upgrade_cap_targets(sdk, targets)).toEqual(caps)
    await expect(
      verify_upgrade_cap_targets(
        sdk,
        targets.map((target, index) => (index === 4 ? { ...target, package: object_id(40) } : target))
      )
    ).rejects.toThrow('does not control active package')
    await expect(
      verify_upgrade_cap_targets(sdk, [targets[0]!, targets[0]!, targets[2]!, targets[3]!, targets[4]!])
    ).rejects.toThrow('five distinct')
  })

  test('recovers finished progress from chain state alone — every target already exists', async () => {
    const template_id = item_template_id('0xc0'.padEnd(66, '0'), '0x5eed'.padEnd(66, '0'), 'ore')
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([admin_cap_id, content_root_id, template_id])),
      content,
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })

    const snapshot = await session.refresh()
    expect(next_seed_batch(snapshot)).toBeNull()
    expect(snapshot.batches.every(({ state }) => state === 'complete')).toBeTrue()
    expect(await session.address_book()).toEqual({ [template_id]: 'item ore' })
  })

  test('reports every inspected batch while deterministic addresses are checked', async () => {
    const session = await create_seed_admin({
      sdk: sdk_with(new Set([admin_cap_id, content_root_id])),
      content,
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })
    const progress: number[] = []
    const snapshot = await session.refresh(({ inspected }) => progress.push(inspected))

    expect(progress).toEqual(snapshot.batches.map((_batch, index) => index + 1))
  })

  test('remembers missing authored addresses instead of rescanning them for every seed batch', async () => {
    const template_id = item_template_id(pinned_content_root_id, seed_package_id, 'ore')
    let missing_reads = 0
    const session = await create_seed_admin({
      sdk: sdk_with(
        new Set([admin_cap_id, content_root_id]),
        {},
        {
          before_objects: (ids) => {
            if (ids.includes(template_id)) missing_reads += 1
          },
        }
      ),
      content,
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })

    await session.check_changes({})
    await session.refresh()
    await session.check_changes({})

    expect(missing_reads).toBe(1)
  })

  test('diffs board replacements, appends, and removals from the catalog length read by the admin session', async () => {
    const board = Object.freeze({
      width: 8,
      height: 8,
      shape_mask: Object.freeze(['1', '0', '0', '0', '0', '0']),
      obstacles: Object.freeze([]),
      holes: Object.freeze([]),
      start_cells_a: Object.freeze([0]),
      start_cells_b: Object.freeze([1]),
    })
    const board_content = Object.freeze({ ...content, boards: Object.freeze([board, { ...board, width: 9 }]) })
    const catalog_id = board_catalog_id(pinned_content_root_id, seed_package_id)
    const template_id = item_template_id(pinned_content_root_id, seed_package_id, 'ore')
    const session = await create_seed_admin({
      sdk: sdk_with(
        new Set([admin_cap_id, content_root_id, template_id, catalog_id]),
        Object.freeze({ [catalog_id]: Object.freeze({ len: 1 }) })
      ),
      content: board_content,
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })

    const view = await session.check_changes({ 'board:0': { hash: 'stale', label: 'board #0' } })

    expect(view.changed.filter(({ domain }) => domain === 'board').map(({ label }) => label)).toEqual([
      'board #0',
      'board #1',
    ])

    const removal_session = await create_seed_admin({
      sdk: sdk_with(
        new Set([admin_cap_id, content_root_id, template_id, catalog_id]),
        Object.freeze({ [catalog_id]: Object.freeze({ len: 3 }) })
      ),
      content: board_content,
      config: { admin_cap: admin_cap_id, content_root: content_root_id },
    })
    const removal = await removal_session.check_changes({})

    expect(removal.board_removals).toEqual([{ key: 'board:2', label: 'board #2' }])
  })
})
