// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import { active_effect_lines, FightEffectLines } from '../../../src/game/fight/FightEffectLines.tsx'
import { render_english } from '../../i18n/render.ts'

test('pending expiration stays visible without inventing another usable turn', () => {
  const effects = active_effect_lines([
    { kind: EFFECT_KINDS.add, stat: CHANNELS.raw_damage, value: 5n, turns_left: 0n, source: 0n, element: '' },
    { kind: EFFECT_KINDS.chatiment, stat: CHANNELS.strength, value: 60n, turns_left: 0n, source: 0n, element: '' },
  ])
  expect(effects.map(({ turns }) => turns)).toEqual([0n, 0n])
  const html = render_english(<FightEffectLines effects={effects} />)
  expect(html).toContain('Until next turn')
  expect(html).not.toContain('0T')
  expect(html).not.toContain('1T')
})

test('stacked effects distinguish pending expiration from remaining turns', () => {
  const effects = active_effect_lines(
    [0n, 2n].map((turns_left) => ({
      kind: EFFECT_KINDS.add,
      stat: CHANNELS.strength,
      value: 5n,
      turns_left,
      source: 0n,
      element: '',
    }))
  )
  const html = render_english(<FightEffectLines effects={effects} />)
  expect(html).toContain('Until next turn')
  expect(html).toContain('2T')
  expect(html).toContain('>10</b>')
})
