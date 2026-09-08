// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_fight_checkpoint } from '../src/reads/get_fight_checkpoint.ts'

const node = (properties: Record<string, unknown>) => ({ properties })

test.each([false, true])(
  'fight hydration resolves remote cosmetic overrides (%s) and immutable wager terms',
  async (cosmetics) => {
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
            worn: [
              { slot: 'hat', item_type: 'solomonk' },
              { slot: 'cloak', item_type: 'cape_fuwa_black' },
              ...(cosmetics
                ? [
                    { slot: 'cosmetic_hat', item_type: 'coiffe_pepe' },
                    { slot: 'cosmetic_cloak', item_type: 'cosmetic_cape' },
                  ]
                : []),
            ],
          },
        ]
      },
    }

    const checkpoint = await get_fight_checkpoint(graph as never, { fight_id: '0xfight' })

    expect(checkpoint?.players['0xcharacter']).toMatchObject({
      hat: cosmetics ? 'coiffe_pepe' : 'solomonk',
      cloak: cosmetics ? 'cosmetic_cape' : 'cape_fuwa_black',
    })
    expect(checkpoint?.kolizeum).toEqual({ id: '0xkolizeum', pledge_mist: '200000000' })
    expect(checkpoint?.contract).toMatchObject({ dungeon: 'tangled_aftermath', dungeon_room: 2 })
  }
)
