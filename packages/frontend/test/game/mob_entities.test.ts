// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.

import { expect, test } from 'bun:test'

import { mob_model_identity } from '../../src/content/mob_models.ts'
import { preload_world_mobs } from '../../src/game/mob_entities.ts'

test('mob type suffixes select variants without duplicating model geometry', () => {
  const models = ['aragne', 'cro_wani', 'fuwa', 'misui']

  expect(mob_model_identity('aragne__fire', models)).toEqual({ basename: 'aragne', variant: 'fire' })
  expect(mob_model_identity('cro_wani__white', models)).toEqual({ basename: 'cro_wani', variant: 'white' })
  expect(mob_model_identity('fuwa__black', models)).toEqual({ basename: 'fuwa', variant: 'black' })
  expect(mob_model_identity('misui__vitality', models)).toEqual({ basename: 'misui', variant: 'vitality' })
})

test('world join preloads every distinct authored mob model once', () => {
  const loaded: string[] = []

  preload_world_mobs([{ mob_type: 'wooling' }, { mob_type: 'razmo' }, { mob_type: 'wooling' }], (mob_type) =>
    loaded.push(mob_type)
  )

  expect(loaded).toEqual(['wooling', 'razmo'])
})
