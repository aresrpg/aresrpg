// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightTargetPreviews } from '../../../src/game/fight/FightTargetPreviews.tsx'
import { active_effect_lines, FightEffectLines } from '../../../src/game/fight/FightEffectLines.tsx'

test('spell aiming restores the fighter nametag with exact resolved HP and status previews', () => {
  const html = renderToStaticMarkup(
    <FightTargetPreviews
      anchors={Object.freeze({ fight_mob_1: Object.freeze({ x: 320, y: 180 }) })}
      critical
      targets={Object.freeze([
        Object.freeze({
          entity_id: 'fight_mob_1',
          fighter: 1n,
          name: 'Bannerwatch',
          allied: false,
          hp_before: 200n,
          hp_after: 160n,
          ap_before: 4n,
          ap_after: 4n,
          ap_delta: -2n,
          mp_before: 4n,
          mp_after: 4n,
          mp_delta: 0n,
          cell_before: 32n,
          cell_after: 34n,
          movements: Object.freeze([Object.freeze({ mode: 'push' as const, cells: 2n })]),
          active_effects: Object.freeze([
            Object.freeze({ kind: 4n, element: '', value: 9n, turns_left: 0n, source: 0n, stat: 9n }),
          ]),
          effects: Object.freeze([
            Object.freeze({ kind: 0n, channel: 12n, element: 'earth', value: 40n, turns: 0n }),
            Object.freeze({ kind: 5n, channel: 6n, element: '', value: 2n, turns: 2n }),
          ]),
        }),
      ])}
    />
  )
  const text = html.replaceAll(/<[^>]+>/g, '')
  const compact_text = text.replaceAll(/\s+/g, ' ').trim()

  expect(html).toContain('Bannerwatch')
  expect(html).toContain('200')
  expect(html).toContain('−40')
  expect(html).toContain('ent-tt__delta--dmg')
  expect(html).toContain('−')
  expect(html).toContain('AP')
  expect(html).toContain('2 turns')
  expect(html).toContain('fxl__txt')
  expect(text).toContain('+9 damages (1 turn)')
  expect(text).toContain('−2 AP (2 turns)')
  expect(compact_text).toContain('Pushes 2 cells')
  expect(compact_text).not.toContain('↦ 34')
  expect(compact_text).not.toContain('Deals 40 damage')
  expect(html).not.toContain(' · ')
  expect(html).not.toContain('fight-hud__effect')
  expect(html).not.toContain('cast_cost')
  expect(html).toContain('ent-tt__delta--crit')
})

test('the compact turn status names a state and keeps the legacy damage-over-time wording', () => {
  const invisible = renderToStaticMarkup(
    <FightEffectLines
      effects={Object.freeze([
        Object.freeze({ kind: 17n, element: '', value: 1n, turns: 2n, stat: 0n, key: 'invisible' }),
      ])}
    />
  ).replaceAll(/<[^>]+>/g, '')

  expect(invisible).toContain('Invisible')
  expect(invisible).not.toContain('Makes the target invisible')

  const poison = renderToStaticMarkup(
    <FightEffectLines
      effects={Object.freeze([
        Object.freeze({ kind: 5n, element: 'earth', value: 6n, turns: 2n, stat: 12n, key: 'poison' }),
      ])}
    />
  )
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

  expect(poison).toBe('6 damages (2 turns)')
  expect(poison).not.toContain('Deals')
})

test('turn-card effects collapse storage rows into totals with compact expiry ranges', () => {
  const html = renderToStaticMarkup(
    <FightEffectLines
      effects={active_effect_lines([
        { kind: 7n, element: '', value: 60n, turns_left: 5n, source: 0n, stat: 0n },
        { kind: 4n, element: '', value: 25n, turns_left: 3n, source: 0n, stat: 0n },
        { kind: 4n, element: '', value: 21n, turns_left: 4n, source: 0n, stat: 0n },
        { kind: 4n, element: '', value: 25n, turns_left: 5n, source: 0n, stat: 0n },
        { kind: 4n, element: '', value: 5n, turns_left: 2n, source: 0n, stat: 3n },
        { kind: 4n, element: '', value: 5n, turns_left: 2n, source: 1n, stat: 3n },
        { kind: 4n, element: '', value: 5n, turns_left: 3n, source: 0n, stat: 3n },
      ])}
    />
  )
  const text = html
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

  expect(text).toContain('CHÂTIMENT · 60 STR/TURN · 5T')
  expect(text).toContain('+71 Strength (3–5T)')
  expect(text).toContain('+15 Agility (2–3T)')
  expect(html).toContain('+25 / 3T · +21 / 4T · +25 / 5T')
  expect(html).toContain('+10 / 2T · +5 / 3T')
  expect(text).not.toContain('Gains up to')
  expect(text).not.toContain('+25 Strength')
})
