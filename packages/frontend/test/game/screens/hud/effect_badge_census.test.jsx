// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2176/#2179 — badge rows read the committed status projection verbatim, and the full spell-effect
// enumeration is total: every kind is badge-bearing or explicitly display-less by design.

import { describe, expect, test } from 'bun:test'
import { STATUS_KINDS } from '@aresrpg/fight/statuses'
import { K_STEAL_STAT } from '@aresrpg/sim/spell_effect'

import {
  committed_badge_rows,
  EFFECT_BADGE_KIND_CENSUS,
  effect_badge_view,
} from '../../../../src/game/screens/hud/EffectBadges.jsx'
import { EFFECT_KIND_NAMES } from '../../../../src/game/screens/hud/fight-spells-core.js'

const t = (key, params = {}) => {
  if (key === 'spells.fx_turns') return `${params.count} turns`
  if (key === 'spells.fx_steal_stat') return `Steal ${params.value} ${params.stat}`
  if (key === 'stat.strength') return 'Strength'
  return key
}

describe('#2176 — committed badge duration', () => {
  test('the badge surface forwards the projection rows without a display-owned counter', () => {
    const rows = [
      { id: 'buff', kind: 9, stat: 0, value: 4, remaining_turns: 2 },
      { id: 'last', kind: 27, remaining_turns: 0 },
    ]
    const projection = { rows, invisible: true, stance_only: false, range_bonus: 0 }

    expect(committed_badge_rows(projection)).toBe(rows)
    expect(committed_badge_rows(null)).toEqual([])
  })
})

describe('#2179 — effect-kind badge census', () => {
  test('every enumerated effect kind has one explicit badge disposition', () => {
    expect(
      Object.keys(EFFECT_BADGE_KIND_CENSUS)
        .map(Number)
        .sort((a, b) => a - b)
    ).toEqual(
      Object.keys(EFFECT_KIND_NAMES)
        .map(Number)
        .sort((a, b) => a - b)
    )
    expect(
      Object.values(EFFECT_BADGE_KIND_CENSUS).every((value) => ['badge', 'display-less-by-design'].includes(value))
    ).toBe(true)
  })

  test('stat steal is admitted by the status door and renders a real badge on both projected halves', () => {
    expect(STATUS_KINDS).toContain(K_STEAL_STAT)
    expect(EFFECT_BADGE_KIND_CENSUS[K_STEAL_STAT]).toBe('badge')
    const halves = [
      { id: 'victim', kind: K_STEAL_STAT, stat: 0, value: -7, remaining_turns: 2 },
      { id: 'caster', kind: K_STEAL_STAT, stat: 0, value: 7, remaining_turns: 2 },
    ]

    for (const row of halves) {
      const view = effect_badge_view(t, row)
      expect(view.label.startsWith('? ')).toBe(false)
      expect(view.label).toContain('Steal')
    }
  })
})
