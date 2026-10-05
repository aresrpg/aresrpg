// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import type { Receipt } from '../src/cache.ts'
import { fight_actions } from '../src/fight.ts'
import { create_gas_ledger } from '../src/gas.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`

test.each([1, 2, 3])(
  'a %i-character fight accounts for creation, grouped joins, turns and the final rebate',
  async (count) => {
    const ledger = create_gas_ledger({ address: id(1), network: 'testnet', storage: null })
    const fight = id(9)
    const cap = {
      objectId: id(3),
      kioskId: id(4),
      version: '1',
      digest: '11111111111111111111111111111111',
      isPersonal: true,
    }
    type Tx = { phase: 'create' | 'join' | 'ready' | 'turn' | 'settle' | 'close'; joins: number }
    const costs = {
      create: [2000n, 8000n, 0n],
      join: [200n, 1000n, 0n],
      ready: [100n, 0n, 0n],
      turn: [400n, 0n, 0n],
      settle: [300n, 0n, 0n],
      close: [200n, 0n, 9000n],
    } as const
    let serial = 0
    const sdk = {
      pins: { content_root: { id: id(61), shared_version: '1' }, seed_package_original: id(60) },
      game_type_package: id(2),
      tx: (): Tx => ({ phase: 'create', joins: 0 }),
      hydrate_unknown: async () => undefined,
      with_owner_kiosk: (tx: Tx, _cap: unknown, compose: (kiosk: string, cap: string) => void) => compose(id(4), id(3)),
      execute: async (tx: Tx, options?: { gas_scope?: string }) => {
        serial++
        const [computation, storage, rebate] = costs[tx.phase]
        const receipt = {
          Transaction: {
            digest: `gas-${serial}`,
            events: tx.phase === 'create' ? [{ type: `${id(2)}::fight::FightCreated`, json: { fight } }] : [],
            effects: {
              gasUsed: {
                computationCost: String(computation),
                storageCost: String(storage * BigInt(Math.max(1, tx.joins))),
                storageRebate: String(rebate),
              },
            },
          },
        } as Receipt
        ledger.record(receipt)
        if (options?.gas_scope) ledger.tag(receipt, options.gas_scope)
        return receipt
      },
      tag_gas: ledger.tag,
      gas_spent_24h: ledger.spent_24h,
      doors: {
        engage_fight: () => 'build',
        launch_fight: () => undefined,
        join_fight: (tx: Tx) => {
          tx.phase = 'join'
          tx.joins++
        },
        ready_and_start_fight: (tx: Tx) => {
          tx.phase = 'ready'
        },
        end_fight_turn: (tx: Tx) => {
          tx.phase = 'turn'
        },
        settle_fight: (tx: Tx) => {
          tx.phase = 'settle'
        },
        close_fight: (tx: Tx) => {
          tx.phase = 'close'
        },
      },
    }
    const actions = fight_actions(sdk as never, { kiosk_cap: async () => cap })
    const created = await actions.engage({
      character_id: id(5),
      world: 'nauvis',
      zone_x: 0,
      zone_z: 0,
      group_index: 0,
      mob_types: [],
    })
    expect(created.fight).toBe(fight)
    expect(actions.gas_spent(fight)).toBe(10000n)
    if (count > 1)
      await actions.join_many({
        fight,
        custody: { kiosk: cap.kioskId, kiosk_cap: cap.objectId },
        character_ids: Array.from({ length: count - 1 }, (_, index) => id(index + 6)),
        team: 0,
      })
    await actions.ready({ fight, fighter_idx: 0n })
    await actions.commit_turn({ fight, actions: [] })
    await actions.settle({
      fight,
      settlements: Array.from({ length: count }, (_, seat) => ({ fighter_idx: BigInt(seat), loot: [] })),
      last: false,
    })
    await actions.close({ fight })
    const expected = 2000n + (count > 1 ? 200n + BigInt(count - 1) * 1000n : 0n)
    expect(actions.gas_spent(fight)).toBe(expected)
    expect(ledger.spent_24h()).toBe(expected)
    expect(actions.gas_spent('unrelated')).toBe(0n)
  }
)
