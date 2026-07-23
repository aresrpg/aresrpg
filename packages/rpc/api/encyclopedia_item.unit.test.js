// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { project_encyclopedia_item } from './views.js'

describe('encyclopedia item projection', () => {
  test('serves stat maxima and weapon damage ranges from one template snapshot', () => {
    expect(
      project_encyclopedia_item(
        {
          template: '0xtplsword',
          item_type: 'weapon',
          name: 'Bronze Sword',
          description: 'A fixture weapon.',
          level: 12,
          category: 'sword',
          stats_min: { vitality: 10, raw_damage: 5 },
          stats_max: { vitality: 20, raw_damage: 15 },
          damages: [
            {
              element: 2,
              damage: 7,
              damage_max: 14,
              crit_damage: 10,
              crit_damage_max: 21,
            },
          ],
        },
        7,
        '2000000000'
      )
    ).toEqual({
      template_id: '0xtplsword',
      item_type: 'weapon',
      name: 'Bronze Sword',
      description: 'A fixture weapon.',
      level: 12,
      category: 'sword',
      supply: 7,
      last_sale_mist: '2000000000',
      stats: { vitality: [10, 20], raw_damage: [5, 15] },
      damages: [
        {
          element: 2,
          damage: 7,
          damage_max: 14,
          crit_damage: 10,
          crit_damage_max: 21,
        },
      ],
    })
  })

  test('keeps honest null legacy maxima and defaults an absent block to empty', () => {
    const legacy = project_encyclopedia_item(
      {
        template: '0xlegacy',
        damages: [
          {
            element: 0,
            damage: 9,
            damage_max: null,
            crit_damage: 13,
            crit_damage_max: null,
          },
        ],
      },
      undefined,
      undefined
    )
    expect(legacy.damages).toEqual([
      {
        element: 0,
        damage: 9,
        damage_max: null,
        crit_damage: 13,
        crit_damage_max: null,
      },
    ])

    expect(project_encyclopedia_item({ template: '0xplain' }, 0, null).damages).toEqual([])
  })
})
