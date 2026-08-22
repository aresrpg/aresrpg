// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { create_character_source, create_fight } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import {
  character_entity_sources,
  fight_character_entity_sources,
} from '../../../src/game/fight/character_entity_sources.ts'
import { fight_mob_entity_sources } from '../../../src/game/fight/mob_entity_sources.ts'

describe('fight character projection', () => {
  test('projects every seat — placed simulator characters and checkpoint players alike', () => {
    const characters = Object.freeze([
      Object.freeze({
        id: 'sim_c1',
        classe: 'senshi',
        male: true,
        colors: Object.freeze(['#112233', '#445566', '#778899'] as const),
        loadout: Object.freeze({ hat: 'solomonk', cloak: 'cape_fuwa_black' }),
      }),
    ])
    expect(character_entity_sources(characters, Object.freeze({ 42: 'sim_c1' }), 'a')).toEqual([
      {
        id: 'sim_c1',
        classe: 'senshi',
        male: true,
        colors: ['#112233', '#445566', '#778899'],
        loadout: { hat: 'solomonk', cloak: 'cape_fuwa_black' },
        cell: 42,
        side: 'a',
      },
    ])

    // Checkpoint players project too, falling back to senshi for missing appearance data.
    const source = create_character_source({ classe: 'yogan', level: 1n })
    const checkpoint = create_fight({
      mode: 'local',
      setup: {
        players: [
          { character: 'known', owner: 'mine', team: 0n, hp: 55n, source },
          { character: 'missing', owner: 'other', team: 1n, hp: 55n, source },
        ],
        mobs: [],
      },
    }).state()
    const sources = fight_character_entity_sources(checkpoint, [
      {
        id: 'known',
        classe: 'senshi',
        male: false,
        colors: ['#111111', '#222222', '#333333'],
        loadout: {},
      },
    ])

    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ id: 'fight_character_0', classe: 'senshi', male: false, side: 'a' })
    expect(sources[1]).toMatchObject({ id: 'fight_character_1', classe: 'yogan', male: true, side: 'b' })
  })

  test('projects allied invisibility as the shared engine visual effect', () => {
    const source = create_character_source({ classe: 'yajin', level: 1n })
    const checkpoint = structuredClone(
      create_fight({
        mode: 'local',
        setup: {
          players: [{ character: 'mine', owner: 'local', team: 0n, hp: 55n, source }],
          mobs: [],
        },
      }).state()
    )
    checkpoint.contract.fighters[0]!.effects = [
      { kind: EFFECT_KINDS.invis, element: '', value: 1n, turns_left: 2n, source: 0n, stat: 0n },
    ]

    expect(fight_character_entity_sources(checkpoint, [], 0n)[0]?.visual_effect).toEqual({ kind: 'invisibility' })
    expect(fight_character_entity_sources(checkpoint, [], 1n)).toEqual([])
    expect(fight_character_entity_sources(checkpoint, [], null)).toEqual([])
  })

  test('dead fighters never become model sources again after a remount', () => {
    const source = create_character_source({ classe: 'senshi', level: 1n })
    const checkpoint = structuredClone(
      create_fight({
        mode: 'local',
        setup: {
          players: [
            { character: 'mine', owner: 'local', team: 0n, hp: 55n, source },
            { character: 'other', owner: 'other', team: 1n, hp: 55n, source },
          ],
          mobs: [],
        },
      }).state()
    )
    checkpoint.contract.fighters[0]!.dead = true
    checkpoint.contract.fighters[1]!.kind = { type: 'mob', snapshot: { mob_type: 'razmo' } } as never
    checkpoint.contract.fighters[1]!.dead = true

    expect(fight_character_entity_sources(checkpoint, [])).toEqual([])
    expect(fight_mob_entity_sources(checkpoint)).toEqual([])
  })
})
