// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { fight_actions } from '../src/fight.ts'
import { dungeon_actions } from '../src/dungeon.ts'
import { kolizeum_actions } from '../src/kolizeum.ts'
import { DOORS } from '../src/doors.gen.ts'

for (const [index, door] of [
  'forfeit_fight_terminal',
  'give_up_dungeon_room_terminal',
  'forfeit_kolizeum_terminal',
].entries()) {
  test(`${door} keeps Random terminal and returns monster-turn witnesses`, async () => {
    const calls: Record<string, unknown>[] = []
    const personal = { objectId: '0x3', kioskId: '0x2', isPersonal: true, version: '1', digest: 'cap' }
    const sdk = {
      tx: () => ({}),
      hydrate_unknown: async () => {},
      with_owner_kiosk: () => {
        throw new Error('A terminal door cannot return a borrowed cap afterward')
      },
      doors: {
        [door]: (_tx: unknown, args: Record<string, unknown>) => {
          calls.push(args)
        },
      },
      execute: async () => ({
        Transaction: {
          digest: 'forfeited',
          events: [{ type: '0x1::fight::TurnSeedUsed', json: { seat: '1', seed: '42' } }],
        },
      }),
    }
    const context = { kiosk_cap: async () => personal }
    const input = { fight: '0xf', fighter_idx: 0n, custody: { kiosk: '0x2', kiosk_cap: '0x3' } }
    const invoke = [
      () => fight_actions(sdk as never, context).forfeit(input),
      () => dungeon_actions(sdk as never, context).give_up_fight(input),
      () => kolizeum_actions(sdk as never, { ...context, address: '0xowner' }).forfeit(input),
    ][index]!
    const receipt = await invoke()
    expect(receipt.turn_witnesses).toEqual([{ fighter: 1n, seed: 42n }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      fight_object: '0xf',
      fighter_idx: 0n,
      kiosk: '0x2',
      personal: { objectId: '0x3' },
    })
    expect(DOORS[door as keyof typeof DOORS].terminal).toBe(true)
  })
}
