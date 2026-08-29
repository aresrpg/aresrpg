// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import spells from '../../../../seed/content/spells.json'

test('Ghostly Claw is a Cross-1 fire hit with a ten-percent three-turn poison rider', () => {
  const ghostly_claw = spells.find(({ name }) => name === 'Ghostly Claw')!

  for (const level of ghostly_claw.levels)
    for (const effects of [level.effects, level.crit_effects]) {
      expect(effects.find(({ kind }) => kind === Number(EFFECT_KINDS.damage))).toMatchObject({
        element: 'fire',
        area_shape: Number(AREA_SHAPES.cross),
        area_size: 1,
        target_filter: Number(TARGET_FILTERS.not_team),
      })
      expect(
        effects.find(({ kind, stat }) => kind === Number(EFFECT_KINDS.remove) && stat === Number(CHANNELS.hp))
      ).toMatchObject({
        element: 'fire',
        area_shape: Number(AREA_SHAPES.cross),
        area_size: 1,
        target_filter: Number(TARGET_FILTERS.not_team),
        chance_bp: 1_000,
        turns: 3,
      })
    }
})
