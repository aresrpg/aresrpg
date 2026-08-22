// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { CharacterAppearanceRender } from '@aresrpg/engine'

import {
  character_render_source,
  presence_render_source,
  world_character_entity,
} from '../../src/game/character_entities.ts'

const character = Object.freeze({
  id: '0xcharacter',
  name: 'Sceat',
  classe: 'yajin',
  sex: 'male',
  experience: '0',
  level: 1,
  color_1: 0x112233,
  color_2: 0x445566,
  color_3: 0x778899,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: Object.freeze({}),
  available_spell_points: 0,
  jobs: Object.freeze({}),
  kiosk: '0xkiosk',
  equipment: Object.freeze([
    Object.freeze({
      id: '0xhat',
      name: 'Hat',
      item_type: 'hat_item',
      category: 'hat',
      level: 1,
      amount: 1,
      slot: 'hat',
    }),
  ]),
})

const appearance = Object.freeze({
  body_url: '/yajin_male.glb',
  hair_url: '/yajin_male_hair.glb',
  colors: Object.freeze(['#112233', '#445566', '#778899'] as const),
  worn: Object.freeze({ head: null, back: null }),
}) satisfies CharacterAppearanceRender

describe('shared character rendering', () => {
  test('a presence row projects into the same render source shape as own characters', () => {
    expect(
      presence_render_source(
        Object.freeze({
          character_id: '0xnearby',
          world: 'overworld',
          owner: '0xowner',
          name: 'Cra',
          classe: 'senshi',
          sex: 'female',
          level: 12,
          color_1: 0x112233,
          color_2: 0x445566,
          color_3: 0x778899,
          hat: 'straw_hat',
          cloak: null,
          title: null,
          pet: 'tofu',
          riding: false,
          x: 50_000,
          y: 64,
          z: 50_000,
        })
      )
    ).toEqual({
      id: '0xnearby',
      classe: 'senshi',
      male: false,
      colors: ['#112233', '#445566', '#778899'],
      loadout: { hat: 'straw_hat' },
    })
  })

  test('projects chain appearance once for both renderers, then anchors it to the controller transform', () => {
    expect(character_render_source(character)).toEqual({
      id: '0xcharacter',
      classe: 'yajin',
      male: true,
      colors: ['#112233', '#445566', '#778899'],
      loadout: { hat: 'hat_item' },
    })

    expect(
      world_character_entity(
        Object.freeze({ id: character.id, appearance }),
        Object.freeze({
          position: Object.freeze([7, 3, 11] as const),
          facing_yaw: Math.PI / 3,
          anim: 'JUMP_RUN',
          gait_scale: 1.4,
        })
      )
    ).toEqual({
      id: '0xcharacter',
      kind: 'character',
      appearance,
      anchor: { kind: 'world', position: [7, 3, 11] },
      facing: { kind: 'yaw', yaw: Math.PI / 3 },
      animation: { name: 'JUMP_RUN', time_scale: 1.4 },
    })
  })
})
