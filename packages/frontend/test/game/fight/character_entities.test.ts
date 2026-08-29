// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { create_character_source, create_fight } from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import { encyclopedia_catalog } from '../../../src/content/catalog.ts'
import {
  character_entity_sources,
  fight_character_entity_sources,
  fight_character_roster_key,
} from '../../../src/game/fight/character_entity_sources.ts'
import { fight_character_entities_from_loaded } from '../../../src/game/fight/character_entities.ts'
import { fight_mob_entity_sources } from '../../../src/game/fight/mob_entity_sources.ts'
import { mob_model_scalar_for_roll } from '../../../src/game/mob_entities.ts'

describe('fight character projection', () => {
  test('placement joins change the appearance roster key without making movement reload models', () => {
    const source = create_character_source({ classe: 'senshi', level: 1n })
    const checkpoint = structuredClone(
      create_fight({
        mode: 'local',
        setup: { players: [{ character: 'first', owner: 'mine', team: 0n, hp: 55n, source }], mobs: [] },
      }).state()
    )
    const initial = fight_character_roster_key(checkpoint)
    checkpoint.contract.fighters[0]!.cell += 1n
    expect(fight_character_roster_key(checkpoint)).toBe(initial)
    checkpoint.contract.fighters.push({
      ...structuredClone(checkpoint.contract.fighters[0]!),
      kind: { type: 'player', character: 'joined', owner: 'mine', level: 1n },
    })
    expect(fight_character_roster_key(checkpoint)).not.toBe(initial)
  })

  test('reprojects a new cell synchronously from an already-loaded appearance', () => {
    const appearance = {
      body_url: '/body.glb',
      hair_url: '/hair.glb',
      colors: ['#111111', '#222222', '#333333'],
      worn: { head: null, back: null },
    } as const
    const source = {
      id: 'fight_character_0',
      classe: 'senshi',
      male: true,
      colors: appearance.colors,
      loadout: {},
      cell: 9,
      side: 'a',
    } as const
    const loaded = [
      {
        id: source.id,
        kind: 'character',
        appearance,
        anchor: { kind: 'fight_cell', cell: 1 },
        facing: { kind: 'fight_opponents', side: 'a' },
      },
    ] as const

    expect(fight_character_entities_from_loaded([source], loaded)[0]?.anchor).toEqual({ kind: 'fight_cell', cell: 9 })
  })

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
    const missing_source = create_character_source({
      classe: 'yogan',
      sex: 'female',
      color_1: 0x123456,
      color_2: 0x789abc,
      color_3: 0xdef012,
      level: 1n,
    })
    const checkpoint = create_fight({
      mode: 'local',
      setup: {
        players: [
          { character: 'known', owner: 'mine', team: 0n, hp: 55n, source },
          { character: 'missing', owner: 'other', team: 1n, hp: 55n, source: missing_source },
        ],
        mobs: [],
      },
    }).state()
    checkpoint.sources.players.missing = {
      ...checkpoint.sources.players.missing!,
      hat: 'solomonk',
      cloak: 'cape_fuwa_black',
    } as never
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
    expect(sources[1]).toMatchObject({
      id: 'fight_character_1',
      classe: 'yogan',
      male: false,
      colors: ['#123456', '#789abc', '#def012'],
      loadout: { hat: 'solomonk', cloak: 'cape_fuwa_black' },
      side: 'b',
    })
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

  test('world rolls and fight snapshots project the same mob model size band', () => {
    const mob = encyclopedia_catalog.mobs[0]!
    const source = create_character_source({ classe: 'senshi', level: 1n })
    const checkpoint = structuredClone(
      create_fight({
        mode: 'local',
        setup: { players: [{ character: 'mine', owner: 'local', team: 0n, hp: 55n, source }], mobs: [] },
      }).state()
    )
    checkpoint.contract.fighters[0]!.kind = {
      type: 'mob',
      snapshot: { mob_type: mob.mob_type, level: BigInt(mob.level_min) },
    } as never

    const fixed = mob.level_min === mob.level_max
    expect(mob_model_scalar_for_roll(mob.mob_type, 0)).toBe(fixed ? 50 : 0)
    expect(mob_model_scalar_for_roll(mob.mob_type, 100)).toBe(fixed ? 50 : 100)
    expect(fight_mob_entity_sources(checkpoint)[0]?.level_scalar).toBe(fixed ? 50 : 0)
    checkpoint.contract.fighters[0]!.kind = {
      type: 'mob',
      snapshot: { mob_type: mob.mob_type, level: BigInt(mob.level_max) },
    } as never
    expect(fight_mob_entity_sources(checkpoint)[0]?.level_scalar).toBe(fixed ? 50 : 100)
  })
})
