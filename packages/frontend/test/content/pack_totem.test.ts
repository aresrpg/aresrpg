// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import spells from '../../../../seed/content/spells.json'

test('Pack Totem is a three-turn raw-damage glyph with opposed team payloads', () => {
  const pack_totem = spells.find(({ name }) => name === 'Pack Totem')!

  for (const level of pack_totem.levels) {
    expect(level.effects.find(({ kind }) => kind === Number(EFFECT_KINDS.glyph))).toMatchObject({
      area_shape: Number(AREA_SHAPES.circle),
      area_size: 1,
      turns: 3,
    })
    expect(
      level.effects.find(({ kind, stat }) => kind === Number(EFFECT_KINDS.add) && stat === Number(CHANNELS.raw_damage))
    ).toMatchObject({ target_filter: Number(TARGET_FILTERS.not_enemy), turns: 1 })
    expect(
      level.effects.find(
        ({ kind, stat }) => kind === Number(EFFECT_KINDS.remove) && stat === Number(CHANNELS.raw_damage)
      )
    ).toMatchObject({ target_filter: Number(TARGET_FILTERS.not_team), turns: 1 })
  }
})
