// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The operator's release path: the authored seed plan creates every row inside protocol limits, sync
// rewrites only what changed and resumes from the last certified batch, deployment receipts project the
// right ids, rewards setup refuses foreign authority, and the final freeze names every lineage.

import { expect, spyOn, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'
import { getWallets, type Wallet } from '@mysten/wallet-standard'

import { as_admin_session } from '../src/admin_auth.ts'
import { admin_wallet_context, create_wallet_auth } from '../src/auth.ts'
import { SDK, type Pins } from '../src/client.ts'
import {
  create_deployment_bootstrap_transaction,
  create_package_publish_transaction,
  create_package_upgrade_transaction,
  create_version_admin_transaction,
  project_bootstrap_deployment,
  project_control_deployment,
  project_game_deployment,
  project_kiosk_package,
  project_math_deployment,
  project_rewards_deployment,
  project_rewards_setup,
  project_seed_deployment,
} from '../src/deployment_admin.ts'
import { AFTERMATH_MAINNET } from '../src/kares_launch.ts'
import { create_seed_plan, giftcards_for_network, recipe_door_args, type SeedContent } from '../src/seed.ts'
import {
  apply_seed_update_batches,
  create_seed_admin,
  create_seed_session_authorization_transaction,
  next_seed_batch,
  project_temp_admin_cap,
  verify_upgrade_cap_targets,
  type SeedApplyProgress,
} from '../src/seed_admin.ts'
import { board_catalog_id, item_template_id, zone_id } from '../src/seed_ids.ts'
import { seed_sync_rows, seed_sync_view } from '../src/seed_sync.ts'
import { seed_update_batches } from '../src/seed_updates.ts'
import { seed_content } from '../../frontend/src/content/canonical_seed.ts'

import { execution_receipt } from './helpers/execution_receipt.ts'
import { simulated_launch } from './helpers/simulated_launch.ts'
import { digest, fake_client, id } from './helpers/transport.ts'

const ADMIN_CAP = id(44)
const SEED_PACKAGE = '0x5eed'.padEnd(66, '0')
const CONTENT_ROOT = '0xc0'.padEnd(66, '0')
const seed_pins: Pins = {
  package: id(22),
  package_original: id(22),
  math_package: id(33),
  control_package: id(5),
  seed_package: SEED_PACKAGE,
  seed_package_original: SEED_PACKAGE,
  content_root: { id: CONTENT_ROOT, shared_version: '1' },
  loot_registry: { id: id(55), shared_version: '1' },
  version: { id: id(3), shared_version: '1' },
}
const armed = (existing: Readonly<Record<string, never>> = {}) => {
  const client = fake_client({ lag: new Map(Object.keys(existing).map((key) => [key, 0])) })
  const sdk = SDK({
    client,
    address: id(99),
    network: 'testnet',
    pins: seed_pins,
    transaction_storage: null,
    sign_transaction: async (tx) => ({ bytes: await tx.build(), signature: '' }),
  })
  sdk.cache.owned.set(ADMIN_CAP, { objectId: ADMIN_CAP, version: '1', digest })
  sdk.cache.shared.set(CONTENT_ROOT, { initialSharedVersion: '1' })
  return { client, sdk }
}
const small: SeedContent = {
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
  spells: [],
  mobs: [],
  recipes: [],
  dungeons: [],
  worlds: [],
  mastery: { offers: [] },
  airdrop: { giftcards: [{ id: 'press', item_type: 'ore', amount: 3, custody: id(66) }] },
  biome_maps: [],
  boards: [],
}
const targets = (tx: Transaction) =>
  tx.getData().commands.flatMap(({ MoveCall }) => (MoveCall ? [`${MoveCall.module}::${MoveCall.function}`] : []))

test('the authored seed plan creates exactly the reconciled rows, inside protocol limits, in dependency order', () => {
  const { sdk } = armed()
  const plan = create_seed_plan(sdk, seed_content)
  const planned = plan.batches.flatMap(({ target_ids }) => target_ids)
  const reconciled = seed_sync_rows(sdk, seed_content).flatMap(({ addresses }) => addresses)
  const planned_set = new Set(planned)
  expect(planned_set).toEqual(new Set(reconciled))
  expect(planned_set.size).toBe(planned.length)
  const created = new Set<string>()
  for (const batch of plan.batches) {
    expect(batch.dependencies.every((dependency) => created.has(dependency) || !planned_set.has(dependency))).toBe(true)
    for (const target of batch.target_ids) sdk.cache.shared.set(target, { initialSharedVersion: '1' })
    const commands =
      batch.build({ admin_cap: ADMIN_CAP, content_root: CONTENT_ROOT }, created)?.getData().commands.length ?? 0
    expect(commands).toBeLessThanOrEqual(1024)
    batch.target_ids.forEach((target) => created.add(target))
  }
  const phases = plan.batches.map(({ phase }) => phase)
  expect(phases.indexOf('items')).toBeLessThan(phases.indexOf('loot_boxes'))
  expect(() =>
    create_seed_plan(sdk, {
      ...small,
      airdrop: { giftcards: [small.airdrop.giftcards[0]!, small.airdrop.giftcards[0]!] },
    })
  ).toThrow('is claimed by both')
  const inputs = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`ingredient_${index}`, 1]))
  expect(() => recipe_door_args(CONTENT_ROOT, SEED_PACKAGE, { output_type: 'ore', inputs }, 'MINER')).toThrow(
    '1..8 distinct ingredients'
  )
  const batch = { id: 'holders', item_type: 'ore', amount: 1, network: 'mainnet' as const, recipients: [id(77)] }
  expect(giftcards_for_network('testnet', { ...small, airdrop: { giftcards: [], giftcard_batches: [batch] } })).toEqual(
    []
  )
  expect(
    giftcards_for_network('mainnet', { ...small, airdrop: { giftcards: [], giftcard_batches: [batch] } })
  ).toHaveLength(1)
  // Captured 2026-08-25 from successful testnet transaction 646PM6JqsZNcbvu3uRcZb4xvYF5BwayTjwe6arQuJkDF.
  expect(
    board_catalog_id(
      '0x1bd402ec24ffc9e82663d88e44bc13b76c3d2cc176d7def52455e53bb1310a98',
      '0x3e7f52a64c7bcea94cdeadd5a0b32b6f83bd03f35aebf8f1060107213a53bb77'
    )
  ).toBe('0x759f42d1cdbc221789b9010d4a12a7dc53ea8b651180fb69417c2d35cb361a73')
  expect(zone_id(`0x${'15'.padStart(64, '0')}`, `0x${'1'.padStart(64, '0')}`, 97, 98)).toBe(
    '0x221731cc0747bc9266dd567cfc5210c7a61badf0e016635df20e96f5dbccb8a9'
  )
})

test('sync rewrites only changed rows within limits and a run resumes after its last certified batch', async () => {
  const { sdk } = armed()
  const ore = item_template_id(CONTENT_ROOT, SEED_PACKAGE, 'ore')
  const box = item_template_id(CONTENT_ROOT, SEED_PACKAGE, 'box')
  const rows = seed_sync_rows(sdk, small)
  const ore_row = rows.find(({ key }) => key === ore)!
  const view = seed_sync_view(
    rows,
    { [ore]: { hash: 'stale', label: 'item ore' }, '0xdead': { hash: 'x', label: 'item old_relic' } },
    (object) => object !== box
  )
  expect([view.changed.map(({ label }) => label), view.removed, view.new_rows.map(({ label }) => label)]).toEqual([
    ['item ore'],
    [{ key: '0xdead', label: 'item old_relic' }],
    ['item box'],
  ])
  expect(
    seed_sync_view(
      rows,
      { [ore]: { hash: ore_row.hash, label: 'item ore', revisions: { [ore]: '7:old' } } },
      () => true,
      0,
      () => '8:new'
    ).changed.map(({ key }) => key)
  ).toContain(ore)
  for (const object_id of [ore, box]) sdk.cache.shared.set(object_id, { initialSharedVersion: '1' })
  const [rewrite] = seed_update_batches(
    sdk,
    rows.filter(({ key }) => key === ore || key === box),
    { admin_cap: ADMIN_CAP, content_root: CONTENT_ROOT }
  )
  expect(targets(rewrite!.build())).toEqual(
    expect.arrayContaining(['item_rows::overwrite_item', 'loot_box::clear_loot_table', 'loot_box::add_loot_reward'])
  )
  const authored = seed_sync_rows(sdk, seed_content).filter(({ update }) => update)
  authored
    .flatMap(({ hydrate }) => hydrate)
    .forEach((object_id) => sdk.cache.shared.set(object_id, { initialSharedVersion: '1' }))
  const batches = seed_update_batches(
    sdk,
    authored,
    { admin_cap: ADMIN_CAP, content_root: CONTENT_ROOT },
    { chain_len: seed_content.boards.length, authored_len: seed_content.boards.length }
  )
  expect(batches.every(({ build }) => build().getData().commands.length <= 1000)).toBe(true)
  expect(batches.flatMap(({ written }) => written)).toEqual(authored.map(({ key }) => key))

  const checkpoints: SeedApplyProgress[] = []
  let executions = 0
  const two = [
    { build: () => sdk.tx(), written: [ore] },
    { build: () => sdk.tx(), written: ['retired'] },
  ]
  const ledger = { [ore]: { hash: 'old', label: 'item ore' }, retired: { hash: 'old', label: 'sale retired' } }
  const run = apply_seed_update_batches(
    two,
    [ore_row],
    ledger,
    async () => {
      executions += 1
      if (executions === 2) throw new Error('second transaction failed')
      return 'FIRST_DIGEST'
    },
    { before_execute: async () => {}, checkpoint: async (progress) => void checkpoints.push(progress) }
  )
  await expect(run).rejects.toThrow('second transaction failed')
  expect([executions, checkpoints.length, checkpoints[0]?.digest, checkpoints[0]?.ledger[ore]?.hash]).toEqual([
    2,
    1,
    'FIRST_DIGEST',
    ore_row.hash,
  ])

  const template = item_template_id(CONTENT_ROOT, SEED_PACKAGE, 'ore')
  const known = (present: readonly string[]) => {
    const { sdk: session_sdk } = armed()
    const objects = Object.fromEntries(
      present.map((object_id) => [
        object_id,
        { objectId: object_id, version: '1', digest, owner: { $kind: 'AddressOwner' as const, AddressOwner: id(99) } },
      ])
    )
    session_sdk.sui_client.core.getObjects = async ({ objectIds }) =>
      ({ objects: objectIds.flatMap((object_id) => (objects[object_id] ? [objects[object_id]] : [])) }) as never
    return session_sdk
  }
  const only_ore = { ...small, items: [small.items[0]!], airdrop: { giftcards: [] } }
  const finished = await create_seed_admin({
    sdk: known([ADMIN_CAP, CONTENT_ROOT, template]),
    content: only_ore,
    config: { admin_cap: ADMIN_CAP, content_root: CONTENT_ROOT },
  })
  const snapshot = await finished.refresh()
  expect([next_seed_batch(snapshot), snapshot.batches.every(({ state }) => state === 'complete')]).toEqual([null, true])
  const pending = await create_seed_admin({
    sdk: known([ADMIN_CAP, CONTENT_ROOT]),
    content: only_ore,
    config: { admin_cap: ADMIN_CAP, content_root: CONTENT_ROOT },
  })
  expect(next_seed_batch(await pending.refresh())).not.toBeNull()
})

test('temporary admin authority is bounded and projected from its own receipt', () => {
  const { sdk } = armed()
  const authorize = create_seed_session_authorization_transaction({
    sdk,
    admin_cap: ADMIN_CAP,
    recipient: id(8),
    funding_mist: 100_000_000n,
  })
  expect(authorize.getData().commands.map(({ $kind }) => $kind)).toEqual([
    'MoveCall',
    'MoveCall',
    'SplitCoins',
    'TransferObjects',
  ])
  expect(() =>
    create_seed_session_authorization_transaction({
      sdk,
      admin_cap: ADMIN_CAP,
      recipient: id(8),
      funding_mist: 50_000_000_001n,
    })
  ).toThrow('between 1 MIST')
  const cap = id(12)
  expect(
    project_temp_admin_cap({
      Transaction: {
        objectTypes: { [cap]: `${id(22)}::admin::AdminCap` },
        effects: {
          changedObjects: [
            {
              objectId: cap,
              idOperation: 'Created',
              outputVersion: '42',
              outputDigest: 'receipt-digest',
              outputOwner: { AddressOwner: id(8) },
            },
          ],
        },
      },
    })
  ).toEqual({ objectId: cap, version: '42', digest: 'receipt-digest' })
})

test('deployment receipts project the published ids and admin transactions call the existing doors', async () => {
  const created = (object_id: string, shared?: string) => ({
    objectId: object_id,
    idOperation: 'Created' as const,
    outputState: 'ObjectWrite',
    outputOwner: shared ? { Shared: { initialSharedVersion: shared } } : null,
  })
  const published = (object_id: string) => ({
    objectId: object_id,
    idOperation: 'Created' as const,
    outputState: 'PackageWrite',
    outputOwner: null,
  })
  // Shape captured from testnet tx BrNo9Vy82qCq94HKR3ifiSfEFBWPZBKWXytqdBXTNj2U on 2026-08-16.
  expect(
    project_math_deployment({
      Transaction: {
        objectTypes: { [id(2)]: '0x2::package::UpgradeCap' },
        effects: { changedObjects: [published(id(1))] },
      },
    })
  ).toEqual({ package: id(1), upgrade_cap: id(2) })
  expect(
    project_control_deployment({
      Transaction: {
        objectTypes: { [id(11)]: `${id(9)}::admin::AdminCap`, [id(13)]: '0x2::package::UpgradeCap' },
        effects: { changedObjects: [published(id(9))] },
      },
    })
  ).toEqual({ package: id(9), admin_cap: id(11), upgrade_cap: id(13) })
  expect(
    project_seed_deployment({
      Transaction: {
        objectTypes: { [id(12)]: `${id(10)}::registry::Registry`, [id(13)]: '0x2::package::UpgradeCap' },
        effects: { changedObjects: [published(id(10)), created(id(12), '5')] },
      },
    })
  ).toMatchObject({ package: id(10), upgrade_cap: id(13), content_root: { id: id(12), shared_version: '5' } })
  // The literal package sentinel was observed in testnet receipt BEnojWNcqiW4ri57r9J2qwgo7RtBGvUxcERhzdtWLndh on 2026-09-06.
  expect(
    project_rewards_deployment({
      Transaction: {
        objectTypes: {
          [id(1)]: 'package',
          [id(2)]: '0x2::package::UpgradeCap',
          [id(3)]: `${id(1)}::economy::Setup`,
          [id(4)]: `${id(1)}::economy::Economy`,
        },
        effects: { changedObjects: [published(id(1)), created(id(4), '42')] },
      },
    })
  ).toEqual({ package: id(1), upgrade_cap: id(2), setup: id(3), economy: { id: id(4), shared_version: '42' } })
  const currency = `0x2::coin_registry::Currency<${id(1)}::kares::KARES>`
  const setup = {
    Transaction: {
      objectTypes: {
        [id(2)]: currency,
        [id(3)]: currency,
        [id(4)]: `${id(1)}::staking::StakingPool<${id(1)}::kares::KARES>`,
        [id(6)]: `${id(1)}::combat_rewards::CombatPot<${id(1)}::kares::KARES>`,
        [id(7)]: `${id(1)}::community::CommunityPool<${id(1)}::kares::KARES>`,
      },
      effects: {
        changedObjects: [
          { objectId: id(2), idOperation: 'Deleted', outputState: 'NotExist', outputOwner: null },
          ...[3, 4, 6, 7].map((n) => created(id(n), '42')),
        ],
      },
    },
  }
  expect(project_rewards_setup(setup as never, id(1), `${id(1)}::kares::KARES`)).toEqual({
    community: { id: id(7), shared_version: '42' },
    pool: { id: id(4), shared_version: '42' },
    combat_pot: { id: id(6), shared_version: '42' },
  })
  // Core-client receipt shape captured from testnet transaction HuTLyE2X9cZ1JK4kwSKHqNAjZokX4CMTUw1fU3DWFrgH on 2026-08-17.
  const policy_types = [
    `0x2::transfer_policy::TransferPolicy<${id(1)}::item::Item>`,
    `0x2::transfer_policy::TransferPolicy<${id(1)}::character::Character>`,
    `${id(1)}::protected_policy::AresRPG_TransferPolicy<${id(1)}::item::Item>`,
    `${id(1)}::protected_policy::AresRPG_TransferPolicy<${id(1)}::character::Character>`,
  ].map(normalizeStructTag)
  const policies = project_bootstrap_deployment(
    {
      Transaction: {
        objectTypes: Object.fromEntries([2, 3, 4, 5].map((n, index) => [id(n), policy_types[index]!])),
        effects: { changedObjects: [2, 3, 4, 5].map((n) => created(id(n), '7')) },
      },
    },
    id(1)
  )
  expect([
    policies.item_policy.id,
    policies.character_policy.id,
    policies.item_protected_policy.id,
    policies.character_protected_policy.id,
  ]).toEqual([id(2), id(3), id(4), id(5)])
  expect(
    project_kiosk_package(
      { package_name: 'aresrpg', digest: [], modules: [], dependencies: ['0x1', '0x2', id(3), id(4), id(5), id(6)] },
      [id(3), id(4), id(5)]
    )
  ).toBe(id(6))
  const game = project_game_deployment({
    kiosk_package: id(8),
    receipt: {
      Transaction: {
        objectTypes: {
          [id(4)]: `${id(1)}::version::Version`,
          [id(5)]: '0x2::package::Publisher',
          [id(7)]: '0x2::package::Publisher',
          [id(2)]: `${id(1)}::world::World`,
        },
        events: [{ type: `${id(1)}::world::WorldCreated`, json: { world: id(2), name: '01_first_shore' } }],
        effects: { changedObjects: [published(id(1)), created(id(2), '7'), created(id(4), '8')] },
      },
    },
  })
  expect([game.package, game.kiosk_package, game.publisher, game.version]).toEqual([
    id(1),
    id(8),
    id(5),
    { id: id(4), shared_version: '8' },
  ])

  expect(
    create_package_publish_transaction({
      artifact: { package_name: 'aresrpg_math', digest: [1, 2, 3], modules: ['AA=='], dependencies: [id(1)] },
      recipient: id(2),
    })
      .getData()
      .commands.map(({ $kind }) => $kind)
  ).toEqual(['Publish', 'TransferObjects'])
  const { sdk } = armed()
  sdk.cache.owned.set(id(3), { objectId: id(3), version: '1', digest })
  sdk.cache.shared.set(id(2), { initialSharedVersion: '1' })
  const upgrade = create_package_upgrade_transaction({
    sdk,
    artifact: { package_name: 'aresrpg_math', digest: [1, 2, 3], modules: ['AA=='], dependencies: [id(2)] },
    package: id(4),
    upgrade_cap: id(3),
    policy: 0,
  })
  expect(upgrade.getData().commands.map(({ $kind }) => $kind)).toEqual(['MoveCall', 'Upgrade', 'MoveCall'])
  expect(upgrade.getData().commands[1]?.Upgrade?.package).toBe(id(4))
  const version = { sdk, package_id: id(1), version: id(2), admin_cap: id(3) }
  expect(
    [
      create_version_admin_transaction({ ...version, action: 'pause' }),
      create_version_admin_transaction({ ...version, action: 'resume' }),
    ].map((tx) => tx.getData().commands[0]?.MoveCall?.function)
  ).toEqual(['admin_freeze', 'admin_update'])
  sdk.cache.owned.set(id(6), { objectId: id(6), version: '1', digest })
  sdk.cache.shared.set(normalizeSuiObjectId('0xd'), { initialSharedVersion: '1' })
  const bootstrap = await create_deployment_bootstrap_transaction({
    sdk,
    package_id: id(1),
    kiosk_package: id(8),
    publisher: id(6),
    recipient: id(9),
  })
  expect(targets(bootstrap)).toEqual(expect.arrayContaining(['protected_policy::mint_and_share']))
})

test('rewards setup refuses foreign or restricted upgrade authority and the final freeze names all six lineages', async () => {
  const account = {
    address: id(200),
    publicKey: new Uint8Array(32),
    chains: ['sui:testnet'],
    features: ['sui:signPersonalMessage', 'sui:signTransaction'],
  }
  const wallet = {
    version: '1.0.0',
    name: 'KARES funding test',
    icon: 'data:image/svg+xml,<svg/>',
    chains: ['sui:testnet'],
    accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
      'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: async () => ({ bytes: '', signature: '' }) },
      'sui:signTransaction': { version: '2.0.0', signTransaction: async () => ({ bytes: '', signature: '' }) },
    },
  } as unknown as Wallet
  const unregister = getWallets().register(wallet)
  try {
    const auth = create_wallet_auth({
      network: 'testnet',
      graphql_url: 'https://example.invalid',
      pins: { kares_package: id(100), kares_upgrade_cap: id(101) },
    })
    const selected = auth.wallets().find(({ name }) => name === wallet.name)!
    await selected.authorize()
    const session = await selected.connect(account.address)
    const context = admin_wallet_context(session)
    const read = spyOn(context.read_client.core, 'getObjects').mockResolvedValue({
      objects: [{ objectId: id(101), json: { package: id(100), version: '1', policy: 0 } }],
    } as never)
    const hydrate = spyOn(context.sdk, 'hydrate').mockImplementation(async () => {
      for (const object_id of [id(101), id(103), id(104), id(105)])
        context.sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
      context.sdk.cache.shared.set(normalizeSuiObjectId('0xc'), { initialSharedVersion: '1' })
      return context.sdk.cache
    })
    const submitted: Transaction[] = []
    const execute = spyOn(context.sdk, 'execute').mockImplementation(async (transaction) => {
      submitted.push(transaction)
      return execution_receipt(new Uint8Array([submitted.length]))
    })
    try {
      const admin = as_admin_session(session)
      const coin_type = `${id(500)}::kares::KARES`
      const terms = {
        currency_package: id(500),
        publication: {
          coin_type,
          liquidity_token_type: `${id(700)}::af_lp::AF_LP`,
          genesis: id(105),
          pool_cap: id(104),
        },
        seed_sui: 1_000_000_000_000n,
        aftermath: AFTERMATH_MAINNET,
        rewards: {
          package: id(100),
          upgrade_cap: id(101),
          setup: id(103),
          economy: { id: id(107), shared_version: '1' },
          currency: { id: id(106), shared_version: '1' },
          coin_type,
          treasury: account.address,
          victory_type: `${id(600)}::fight_rewards::BossVictory`,
        },
      }
      // The wallet is never asked while the chain's simulation of the launch is not the reviewed one.
      const simulate = spyOn(context.sdk, 'simulate').mockResolvedValue({ FailedTransaction: {} } as never)
      await expect(admin.launch_currency(terms)).rejects.toThrow('nothing was signed')
      expect(submitted).toHaveLength(0)
      simulate.mockResolvedValue(simulated_launch(terms, account.address) as never)
      await admin.launch_currency(terms)
      simulate.mockRestore()
      expect(submitted[0]?.getData().commands.flatMap(({ MoveCall }) => (MoveCall ? [MoveCall.function] : []))).toEqual(
        ['split', 'create_pool_2_coins_v2', 'new', 'public_share_object', 'setup']
      )
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(999), version: '1', policy: 0 } }],
      } as never)
      await expect(admin.launch_currency(terms)).rejects.toThrow()
      read.mockResolvedValue({
        objects: [{ objectId: id(101), json: { package: id(100), version: '1', policy: 192 } }],
      } as never)
      await expect(admin.launch_currency(terms)).rejects.toThrow('unrestricted upgrade authority')
      expect(submitted).toHaveLength(1)
    } finally {
      read.mockRestore()
      hydrate.mockRestore()
      execute.mockRestore()
      await session.disconnect()
    }
  } finally {
    unregister()
  }

  const prefixes = ['math_', 'control_', 'combat_', 'seed_', 'kares_rewards_', '']
  const caps = prefixes.map((_, index) => id(20 + index))
  const packages = prefixes.map((_, index) => id(30 + index))
  const freeze_pins = Object.fromEntries(
    prefixes.flatMap((prefix, index) => [
      [`${prefix}upgrade_cap`, caps[index]],
      [`${prefix}package`, packages[index]],
    ])
  )
  const freezer = {
    pins: freeze_pins,
    sui_client: {
      core: {
        getObjects: async () => ({
          objects: caps.map((object_id, index) => ({ objectId: object_id, json: { package: packages[index] } })),
        }),
      },
    },
  }
  expect(await verify_upgrade_cap_targets(freezer as never)).toEqual(caps)
  await expect(
    verify_upgrade_cap_targets({ ...freezer, pins: { ...freeze_pins, kares_rewards_package: id(40) } } as never)
  ).rejects.toThrow('does not control active package')
  await expect(
    verify_upgrade_cap_targets({ ...freezer, pins: { ...freeze_pins, kares_rewards_upgrade_cap: caps[0] } } as never)
  ).rejects.toThrow('six distinct')
  await expect(
    verify_upgrade_cap_targets({ ...freezer, pins: { ...freeze_pins, kares_rewards_upgrade_cap: undefined } } as never)
  ).rejects.toThrow('kares_rewards_UpgradeCap')
})
