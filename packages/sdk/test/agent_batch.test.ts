// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { KioskClient } from '@mysten/kiosk'

import { compose_agent_batch } from '../src/agent_batch.ts'
import { with_personal_kiosk } from '../src/ptb.ts'
import {
  agent_batch_fits,
  read_agent_batch_limits,
  submit_agent_batches,
  type AgentBatchLimits,
} from '../src/agent_batch_limits.ts'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const cap = {
  objectId: id(5),
  kioskId: id(6),
  isPersonal: true,
  version: '1',
  digest: '11111111111111111111111111111111',
}
const limits: AgentBatchLimits = {
  commands: 1024,
  objects: 2048,
  bytes: 131072,
  arguments: 512,
  pure_bytes: 16384,
  gas_objects: 256,
}
const kiosk_client = new KioskClient({ client: {} as never, network: 'mainnet' })
const fixtures = () => {
  const sdk = {
    game_type_package: id(1),
    pins: {
      package: id(1),
      kiosk_package: id(2),
      character_policy: { id: id(3) },
      item_policy: { id: id(4) },
      version: { id: id(8) },
    },
    tx: () => new Transaction(),
    hydrate: async () => {},
    with_personal_kiosk: (
      tx: Transaction,
      owner: typeof cap | null,
      compose: Parameters<typeof with_personal_kiosk>[3]
    ) => with_personal_kiosk(tx, kiosk_client, owner, compose),
    get_owned_kiosks: async () => ({ kioskOwnerCaps: [cap], hasNextPage: false }),
    get_kiosk: async () => ({
      items: [id(20), id(21)].map((object_id) => ({
        objectId: object_id,
        kioskId: cap.kioskId,
        type: `${id(1)}::item::Item`,
      })),
    }),
    doors: {
      unequip_item: (tx: Transaction) => tx.moveCall({ target: `${id(1)}::api::unequip_item` }),
      equip_item: (tx: Transaction) => tx.moveCall({ target: `${id(1)}::api::equip_item` }),
    },
  }
  const purchase_cap = bcs.struct('PurchaseCap', {
    id: bcs.Address,
    kiosk_id: bcs.Address,
    item_id: bcs.Address,
    min_price: bcs.u64(),
  })
  const client = {
    core: {
      getTransaction: async () => ({
        Transaction: {
          digest: 'batch-offer',
          status: { success: true },
          transaction: { sender: id(9) },
          events: [],
          effects: {
            changedObjects: [20, 21].map((n) => ({
              objectId: id(n + 30),
              idOperation: 'Created',
              outputVersion: '1',
              outputDigest: 'cap-digest',
              outputOwner: { $kind: 'AddressOwner', AddressOwner: id(10) },
            })),
          },
        },
      }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((object_id) => ({ objectId: object_id, version: '1' })),
      }),
      listOwnedObjects: async ({ type }: { type: string }) => ({
        hasNextPage: false,
        objects: type.includes('::item::Item')
          ? [20, 21].map((n) => ({
              objectId: id(n + 30),
              version: '1',
              digest: 'cap-digest',
              previousTransaction: 'batch-offer',
              type,
              owner: { $kind: 'AddressOwner', AddressOwner: id(10) },
              content: purchase_cap
                .serialize({ id: id(n + 30), kiosk_id: cap.kioskId, item_id: id(n), min_price: 0 })
                .toBytes(),
            }))
          : [],
      }),
    },
  }
  return {
    sdk,
    context: {
      address: id(9),
      client: client as never,
      limits,
      kiosk_cap: async () => cap,
      recipient: () => id(10),
      check_offer: async () => {},
      check_return: async () => {},
    },
  }
}
const move_calls = (tx: Transaction) =>
  tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : []))

test('two equipped characters and two items share one offer PTB', async () => {
  const f = fixtures()
  const tx = await compose_agent_batch(f.sdk as never, f.context, {
    kind: 'offer_batch',
    recipient: id(10),
    characters: [11, 12].map((n) => ({
      character_id: id(n),
      kiosk: cap.kioskId,
      unequip: [{ slot: 'weapon', item_id: id(n + 100) }],
    })),
    items: [20, 21].map((n) => ({ item_id: id(n), kiosk: cap.kioskId, version: '1' })),
  })
  expect(move_calls(tx).filter((name) => name === 'list_with_purchase_cap')).toHaveLength(6)
  expect(move_calls(tx).filter((name) => name === 'unequip_item')).toHaveLength(2)
  expect(tx.getData().sender).toBe(id(9))
})

test('multiple characters, gear and items claim into one newly created personal kiosk', async () => {
  const f = fixtures()
  const tx = await compose_agent_batch(
    f.sdk as never,
    { ...f.context, address: id(10), kiosk_cap: async () => null },
    {
      kind: 'claim_batch',
      agent_address: id(9),
      characters: [11, 12].map((n) => ({
        character_id: id(n),
        seller_kiosk: cap.kioskId,
        purchase_cap: id(n + 60),
        recipient: id(10),
        agent_address: id(9),
        equipment: [{ slot: 'weapon', item_id: id(n + 100), purchase_cap: id(n + 70) }],
      })),
      items: [20, 21].map((n) => ({
        item_id: id(n),
        seller_kiosk: cap.kioskId,
        purchase_cap: id(n + 30),
        recipient: id(10),
        agent_address: id(9),
      })),
    }
  )
  expect(move_calls(tx).filter((name) => name === 'purchase_with_cap')).toHaveLength(6)
  expect(
    tx
      .getData()
      .commands.filter((command) => command.MoveCall?.module === 'kiosk' && command.MoveCall.function === 'new')
  ).toHaveLength(1)
  expect(move_calls(tx).filter((name) => name === 'equip_item')).toHaveLength(2)
})

test('network limits are read without adding an application cap', async () => {
  const value = await read_agent_batch_limits({
    ledgerService: {
      getEpoch: async () => ({
        response: {
          epoch: {
            protocolConfig: {
              configs: {},
              attributes: {
                max_programmable_tx_commands: '1024',
                max_input_objects: '2048',
                max_tx_size_bytes: '131072',
                max_arguments: '512',
                max_pure_argument_size: '16384',
                max_gas_payment_objects: '256',
              },
            },
          },
        },
      }),
    },
  } as never)
  expect(value).toEqual(limits)
})

test('batching packs the largest fitting prefix and never retries a submitted failure', async () => {
  const sent: number[][] = []
  await submit_agent_batches(
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    async (rows) => rows.length <= 4,
    async (rows) => {
      sent.push([...rows])
    }
  )
  expect(sent).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9]])
  sent.length = 0
  await expect(
    submit_agent_batches(
      [1, 2, 3, 4, 5],
      async (rows) => rows.length <= 2,
      async (rows) => {
        sent.push([...rows])
        if (sent.length === 2) throw new Error('outcome unknown')
      }
    )
  ).rejects.toThrow('outcome unknown')
  expect(sent).toEqual([
    [1, 2],
    [3, 4],
  ])
})

test('one indivisible character that cannot fit refuses before submission', async () => {
  let sent = false
  await expect(
    submit_agent_batches(
      [1],
      async () => false,
      async () => {
        sent = true
      }
    )
  ).rejects.toThrow('One asset')
  expect(sent).toBe(false)
})

test('command, argument, object and byte boundaries are checked before signing', async () => {
  const tx = new Transaction()
  tx.moveCall({ target: '0x2::fixture::first' })
  tx.moveCall({ target: '0x2::fixture::second' })
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 1, commands: 2 })).toBe(false)
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 1, commands: 3, bytes: 1 })).toBe(false)
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 1, commands: 3 })).toBe(true)
  expect(await agent_batch_fits({} as never, tx, { ...limits, gas_objects: 3, objects: 2 })).toBe(false)
  const transfer = new Transaction()
  transfer.transferObjects(
    [1, 2, 3].map((n) => transfer.objectRef({ objectId: id(n), version: '1', digest: cap.digest })),
    id(9)
  )
  expect(await agent_batch_fits({} as never, transfer, { ...limits, gas_objects: 1, arguments: 2 })).toBe(false)
})

test('a retained recovery executor refreshes equipped Receiving refs before composing a return batch', async () => {
  const f = fixtures()
  let cached_version = '1'
  const sdk = {
    ...f.sdk,
    hydrate: async (ids: readonly string[]) => {
      expect(ids).toEqual([id(111)])
      cached_version = '2'
    },
    doors: {
      ...f.sdk.doors,
      unequip_item: (tx: Transaction) =>
        tx.moveCall({
          target: `${id(1)}::api::unequip_item`,
          arguments: [tx.receivingRef({ objectId: id(111), version: cached_version, digest: cap.digest })],
        }),
    },
  }
  const tx = await compose_agent_batch(sdk as never, f.context, {
    kind: 'offer_batch',
    recipient: id(10),
    items: [],
    characters: [{ character_id: id(11), kiosk: cap.kioskId, unequip: [{ slot: 'weapon', item_id: id(111) }] }],
  })
  expect(
    tx.getData().inputs.flatMap((input) => (input.Object?.Receiving ? [input.Object.Receiving.version] : []))
  ).toEqual(['2'])
})
