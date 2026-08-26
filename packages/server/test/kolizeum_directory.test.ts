// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_kolizeums } from '../src/reads/get_kolizeums.ts'

test('the directory preserves explicit sides and permits several characters from one wallet', async () => {
  let reads = 0
  const graph = {
    read: async () => {
      reads += 1
      if (reads === 1)
        return [
          {
            kolizeum: {
              properties: {
                id: '0xk1',
                fight_id: '0xf1',
                format: 3,
                pledge: '1000000000',
                pot: '3000000000',
                level_min: 10,
                level_max: 30,
                allowed: null,
              },
            },
            fight: {
              properties: {
                phase: 'placement',
                machine: JSON.stringify({
                  fighters: [
                    { team: 0, settled: false, kind: { player: { character: '0xc1', owner: '0xme', level: 20 } } },
                    { team: 1, settled: false, kind: { player: { character: '0xc2', owner: '0xme', level: 21 } } },
                    { team: 0, settled: false, kind: { player: { character: '0xc3', owner: '0xother', level: 19 } } },
                  ],
                }),
              },
            },
          },
        ]
      return [
        { id: '0xc1', name: 'Ari', classe: 'senshi', level: 20 },
        { id: '0xc2', name: 'Bex', classe: 'yogan', level: 21 },
        { id: '0xc3', name: 'Cyr', classe: 'mori', level: 19 },
      ]
    },
  }

  expect(await get_kolizeums(graph as never, { address: '0xme' })).toEqual([
    {
      id: '0xk1',
      fight: '0xf1',
      creator: '0xme',
      format: 3,
      pledge_mist: '1000000000',
      pot_mist: '3000000000',
      level_min: 10,
      level_max: 30,
      public: true,
      can_join: true,
      status: 'open',
      fighters: [
        { seat: 0, team: 0, character_id: '0xc1', name: 'Ari', classe: 'senshi', level: 20, settled: false },
        { seat: 1, team: 1, character_id: '0xc2', name: 'Bex', classe: 'yogan', level: 21, settled: false },
        { seat: 2, team: 0, character_id: '0xc3', name: 'Cyr', classe: 'mori', level: 19, settled: false },
      ],
    },
  ])
})
