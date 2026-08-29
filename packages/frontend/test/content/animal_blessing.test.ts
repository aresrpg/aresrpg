// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'

import spells from '../../../../seed/content/spells.json'

test('Chimeric Venom applies independent Water and Fire poison rolls in a Ring-1 area', () => {
  const chimeric_venom = spells.find(({ name }) => name === 'Chimeric Venom')!

  for (const level of chimeric_venom.levels)
    for (const effects of [level.effects, level.crit_effects]) {
      const poisons = effects.filter(
        ({ kind, stat }) => kind === Number(EFFECT_KINDS.remove) && stat === Number(CHANNELS.hp)
      )
      expect(poisons.map(({ element }) => element).toSorted()).toEqual(['fire', 'water'])
      expect(
        poisons.every(
          ({ area_shape, area_size, target_filter, chance_bp, turns }) =>
            area_shape === Number(AREA_SHAPES.ring) &&
            area_size === 1 &&
            target_filter === Number(TARGET_FILTERS.not_team) &&
            chance_bp === 5_000 &&
            turns === 3
        )
      ).toBeTrue()
    }
})
