// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { TransactionPlugin } from '@mysten/sui/transactions'
import { normalizeStructTag, normalizeSuiObjectId } from '@mysten/sui/utils'

import {
  create_package_upgrade_transaction,
  create_package_publish_transaction,
  create_deployment_bootstrap_transaction,
  create_version_admin_transaction,
  project_game_deployment,
  project_kiosk_package,
  project_bootstrap_deployment,
  project_math_deployment,
  project_control_deployment,
  project_seed_deployment,
  DISPLAY_REGISTRY_ID,
} from '../src/deployment_admin.ts'
import { SDK, type Pins, type SuiTransport } from '../src/client.ts'

const id = (digit: string): string => `0x${digit.repeat(64)}`
const resolve_transaction: TransactionPlugin = async (_data, _options, next) => next()

describe('deployment admin', () => {
  test('publishing transfers the new upgrade capability to the connected wallet', () => {
    const transaction = create_package_publish_transaction({
      artifact: { package_name: 'aresrpg_math', digest: [1, 2, 3], modules: ['AA=='], dependencies: [id('1')] },
      recipient: id('2'),
    })

    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['Publish', 'TransferObjects'])
  })

  test('upgrading authorizes and commits against the current package object', () => {
    const sdk = SDK({
      address: id('9'),
      pins: { package: id('1'), math_package: id('5') } satisfies Pins,
      client: {
        core: {
          resolveTransactionPlugin: () => resolve_transaction,
          getBalance: async () => ({ balance: { balance: '0' } }),
          getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
          getChainIdentifier: async () => ({ chainIdentifier: id('0') }),
          getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
          listCoins: async () => ({ objects: [] }),
          getObjects: async () => ({ objects: [] }),
          simulateTransaction: async () => ({}),
          executeTransaction: async () => ({}),
          waitForTransaction: async () => ({}),
        },
      } as SuiTransport,
    })
    sdk.cache.owned.set(id('3'), { objectId: id('3'), version: '1', digest: 'digest' })
    const transaction = create_package_upgrade_transaction({
      sdk,
      artifact: { package_name: 'aresrpg_math', digest: [1, 2, 3], modules: ['AA=='], dependencies: [id('2')] },
      package: id('4'),
      upgrade_cap: id('3'),
      policy: 0,
    })

    expect(transaction.getData().commands.map(({ $kind }) => $kind)).toEqual(['MoveCall', 'Upgrade', 'MoveCall'])
    expect(transaction.getData().commands[0]?.MoveCall).toMatchObject({
      package: normalizeSuiObjectId('0x2'),
      module: 'package',
      function: 'authorize_upgrade',
    })
    expect(transaction.getData().commands[1]?.Upgrade?.package).toBe(id('4'))
    expect(transaction.getData().commands[2]?.MoveCall).toMatchObject({
      package: normalizeSuiObjectId('0x2'),
      module: 'package',
      function: 'commit_upgrade',
    })
  })

  test('projects a published package from the core PackageWrite effect', () => {
    // Shape captured from testnet tx BrNo9Vy82qCq94HKR3ifiSfEFBWPZBKWXytqdBXTNj2U on 2026-08-16.
    const package_id = id('1')
    const deployment = project_math_deployment({
      Transaction: {
        objectTypes: { [id('2')]: '0x2::package::UpgradeCap' },
        effects: {
          changedObjects: [
            {
              objectId: package_id,
              idOperation: 'Created',
              outputState: 'PackageWrite',
              outputOwner: null,
            },
          ],
        },
      },
    })

    expect(deployment).toEqual({ package: package_id, upgrade_cap: id('2') })
  })

  test('pause and resume call the existing version administration doors', () => {
    const sdk = SDK({
      address: id('9'),
      pins: { package: id('1'), math_package: id('5') } satisfies Pins,
      client: {
        core: {
          resolveTransactionPlugin: () => resolve_transaction,
          getBalance: async () => ({ balance: { balance: '0' } }),
          getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
          getChainIdentifier: async () => ({ chainIdentifier: id('0') }),
          getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
          listCoins: async () => ({ objects: [] }),
          getObjects: async () => ({ objects: [] }),
          simulateTransaction: async () => ({}),
          executeTransaction: async () => ({}),
          waitForTransaction: async () => ({}),
        },
      } as SuiTransport,
    })
    sdk.cache.shared.set(id('2'), { initialSharedVersion: '1' })
    sdk.cache.owned.set(id('3'), { objectId: id('3'), version: '1', digest: 'digest' })
    const inputs = { sdk, package_id: id('1'), version: id('2'), admin_cap: id('3') }
    const pause = create_version_admin_transaction({ ...inputs, action: 'pause' })
    const resume = create_version_admin_transaction({ ...inputs, action: 'resume' })

    expect(pause.getData().commands[0]?.MoveCall?.function).toBe('admin_freeze')
    expect(resume.getData().commands[0]?.MoveCall?.function).toBe('admin_update')
  })

  test('bootstraps every post-publish object in one PTB without a Move wrapper', async () => {
    const sdk = SDK({
      address: id('9'),
      pins: { package: id('0'), math_package: id('5') } satisfies Pins,
      client: {
        core: {
          resolveTransactionPlugin: () => resolve_transaction,
          getBalance: async () => ({ balance: { balance: '0' } }),
          getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
          getChainIdentifier: async () => ({ chainIdentifier: id('0') }),
          getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
          listCoins: async () => ({ objects: [] }),
          getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
            objects: objectIds.map((object_id) =>
              object_id === DISPLAY_REGISTRY_ID
                ? {
                    objectId: `0x${'d'.padStart(64, '0')}`,
                    owner: { Shared: { initialSharedVersion: '1' } },
                  }
                : { objectId: object_id, version: '1', digest: '11111111111111111111111111111111' }
            ),
          }),
          simulateTransaction: async () => ({}),
          executeTransaction: async () => ({}),
          waitForTransaction: async () => ({}),
        },
      } as SuiTransport,
    })
    await sdk.hydrate([id('4'), DISPLAY_REGISTRY_ID])
    const transaction = await create_deployment_bootstrap_transaction({
      sdk,
      package_id: id('1'),
      kiosk_package: id('8'),
      publisher: id('4'),
      recipient: id('9'),
    })
    expect(transaction.getData().commands[0]?.MoveCall).toMatchObject({
      package: id('1'),
      module: 'admin',
      function: 'create_item_display',
    })
    const calls = transaction.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall] : []))
    const local_calls = calls
      .filter(({ package: called_package }) => called_package === id('1'))
      .map(({ module, function: called_function }) => `${module}::${called_function}`)

    expect(local_calls).toEqual([
      'admin::create_item_display',
      'admin::create_character_display',
      'protected_policy::mint_and_share',
      'protected_policy::mint_and_share',
      'listing_rule::add',
      'lot_rule::add',
      'naked_rule::add',
    ])
    expect(calls.some(({ package: called_package }) => called_package === id('0'))).toBeFalse()
    expect(
      calls
        .filter(({ module }) => ['royalty_rule', 'personal_kiosk_rule', 'kiosk_lock_rule'].includes(module))
        .map(({ package: rule_package, module }) => `${rule_package}::${module}`)
    ).toEqual([
      `${id('8')}::royalty_rule`,
      `${id('8')}::personal_kiosk_rule`,
      `${id('8')}::kiosk_lock_rule`,
      `${id('8')}::royalty_rule`,
      `${id('8')}::personal_kiosk_rule`,
      `${id('8')}::kiosk_lock_rule`,
    ])
    const pure_inputs = transaction.getData().inputs.flatMap((input) => (input.Pure ? [input.Pure.bytes] : []))
    expect(pure_inputs.filter((bytes) => bytes === '6AM=')).toHaveLength(2) // u16 1000 = 10%
    expect(pure_inputs.filter((bytes) => bytes === 'gJaYAAAAAAA=')).toHaveLength(2) // u64 10M MIST = 0.01 SUI
    expect(
      calls.some(({ module, function: called_function }) => module === 'deployment' && called_function === 'bootstrap')
    ).toBe(false)
    expect(transaction.getData().commands.filter(({ $kind }) => $kind === 'TransferObjects')).toHaveLength(3)
    expect((await transaction.build({ onlyTransactionKind: true })).length).toBeGreaterThan(0)
  })

  test('projects every shared policy created by bootstrap', () => {
    const package_id = id('1')
    const item = `${package_id}::item::Item`
    const character = `${package_id}::character::Character`
    // Core-client receipt shape captured from testnet transaction
    // HuTLyE2X9cZ1JK4kwSKHqNAjZokX4CMTUw1fU3DWFrgH on 2026-08-17.
    const types = [
      `0x2::transfer_policy::TransferPolicy<${item}>`,
      `0x2::transfer_policy::TransferPolicy<${character}>`,
      `${package_id}::protected_policy::AresRPG_TransferPolicy<${item}>`,
      `${package_id}::protected_policy::AresRPG_TransferPolicy<${character}>`,
    ].map(normalizeStructTag)
    const object_ids = [id('2'), id('3'), id('4'), id('5')]
    const deployment = project_bootstrap_deployment(
      {
        Transaction: {
          objectTypes: Object.fromEntries(object_ids.map((object_id, index) => [object_id, types[index]!])),
          effects: {
            changedObjects: object_ids.map((object_id, index) => ({
              objectId: object_id,
              idOperation: 'Created' as const,
              outputOwner: { Shared: { initialSharedVersion: String(index + 7) } },
            })),
          },
        },
      },
      package_id
    )

    expect(deployment.item_policy.id).toBe(id('2'))
    expect(deployment.character_policy.id).toBe(id('3'))
    expect(deployment.item_protected_policy.id).toBe(id('4'))
    expect(deployment.character_protected_policy.id).toBe(id('5'))
  })

  test('projects the Kiosk package linked by the compiled game artifact', () => {
    expect(
      project_kiosk_package(
        {
          package_name: 'aresrpg',
          digest: [],
          modules: [],
          dependencies: ['0x1', '0x2', id('3'), id('4'), id('5'), id('6')],
        },
        [id('3'), id('4'), id('5')]
      )
    ).toBe(id('6'))
  })

  test('publication facts use receipt-created Publishers and worlds without post-publish reads', () => {
    const package_id = id('1')
    const world_id = id('2')
    const deployment = project_game_deployment({
      kiosk_package: id('8'),
      receipt: {
        Transaction: {
          objectTypes: {
            [id('4')]: `${package_id}::version::Version`,
            [id('5')]: '0x2::package::Publisher',
            [id('7')]: '0x2::package::Publisher',
            [world_id]: `${package_id}::world::World`,
          },
          events: [
            {
              type: `${package_id}::world::WorldCreated`,
              json: { world: world_id, name: '01_first_shore' },
            },
          ],
          effects: {
            changedObjects: [
              { objectId: package_id, idOperation: 'Created', outputState: 'PackageWrite', outputOwner: null },
              { objectId: world_id, idOperation: 'Created', outputOwner: { Shared: { initialSharedVersion: '7' } } },
              { objectId: id('4'), idOperation: 'Created', outputOwner: { Shared: { initialSharedVersion: '8' } } },
            ],
          },
        },
      },
    })

    expect(deployment.package).toBe(package_id)
    expect(deployment.kiosk_package).toBe(id('8'))
    expect(deployment.item_publisher).toBe(id('5'))
    expect(deployment.character_publisher).toBe(id('5'))
    expect(deployment.version).toEqual({ id: id('4'), shared_version: '8' })
  })

  test('projects the control publication: the ONE AdminCap', () => {
    const package_id = id('9')
    const deployment = project_control_deployment({
      Transaction: {
        objectTypes: {
          [id('b')]: `${package_id}::admin::AdminCap`,
          [id('d')]: '0x2::package::UpgradeCap',
        },
        effects: {
          changedObjects: [
            { objectId: package_id, idOperation: 'Created', outputState: 'PackageWrite', outputOwner: null },
          ],
        },
      },
    })

    expect(deployment).toEqual({ package: package_id, admin_cap: id('b'), upgrade_cap: id('d') })
  })

  test('projects the seed publication and its shared Registry root', () => {
    const package_id = id('a')
    const deployment = project_seed_deployment({
      Transaction: {
        objectTypes: {
          [id('c')]: `${package_id}::registry::Registry`,
          [id('d')]: '0x2::package::UpgradeCap',
        },
        effects: {
          changedObjects: [
            { objectId: package_id, idOperation: 'Created', outputState: 'PackageWrite', outputOwner: null },
            { objectId: id('c'), idOperation: 'Created', outputOwner: { Shared: { initialSharedVersion: '5' } } },
          ],
        },
      },
    })

    expect(deployment.package).toBe(package_id)
    expect(deployment.upgrade_cap).toBe(id('d'))
    expect(deployment.content_root).toEqual({ id: id('c'), shared_version: '5' })
  })
})
