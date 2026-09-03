// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_fight_checkpoint } from '../src/reads/get_fight_checkpoint.ts'

const node = (properties: Record<string, unknown>) => ({ properties })

test('fight hydration carries remote wearables and immutable wager terms', async () => {
  let reads = 0
  const graph = {
    read: async () => {
      reads += 1
      if (reads === 1)
        return [
          {
            fight: node({
              id: '0xfight',
              world: 'nauvis',
              dungeon: 'tangled_aftermath',
              dungeon_room: 2,
              phase: 'placement',
              machine: JSON.stringify({
                fighters: [{ kind: { player: { character: '0xcharacter', owner: '0xowner', level: 10 } } }],
              }),
            }),
            kolizeum: node({ id: '0xkolizeum', pledge: '200000000' }),
          },
        ]
      return [
        {
          character: node({
            id: '0xcharacter',
            name: 'Remote',
            classe: 'yogan',
            sex: 'female',
            color_1: 1,
            color_2: 2,
            color_3: 3,
            level: 10,
          }),
          weapon: null,
          hat: node({ item_type: 'solomonk' }),
          cloak: node({ item_type: 'cape_fuwa_black' }),
        },
      ]
    },
  }

  const checkpoint = await get_fight_checkpoint(graph as never, { fight_id: '0xfight' })

  expect(checkpoint?.players['0xcharacter']).toMatchObject({
    hat: 'solomonk',
    cloak: 'cape_fuwa_black',
  })
  expect(checkpoint?.kolizeum).toEqual({ id: '0xkolizeum', pledge_mist: '200000000' })
  expect(checkpoint?.contract).toMatchObject({ dungeon: 'tangled_aftermath', dungeon_room: 2 })
})
