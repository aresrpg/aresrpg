// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightTargetPreviews } from '../../../src/game/fight/FightTargetPreviews.tsx'

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
          cell_after: 32n,
          active_effects: Object.freeze([
            Object.freeze({ kind: 4n, element: '', value: 9n, turns_left: 0n, source: 0n, stat: 9n }),
          ]),
          effects: Object.freeze([Object.freeze({ kind: 5n, channel: 6n, element: '', value: 2n, turns: 2n })]),
        }),
      ])}
    />
  )
  const text = html.replaceAll(/<[^>]+>/g, '')

  expect(html).toContain('Bannerwatch')
  expect(html).toContain('200')
  expect(html).toContain('−40')
  expect(html).toContain('−')
  expect(html).toContain('Ap')
  expect(html).toContain('2 turns')
  expect(html).toContain('fxl__txt')
  expect(text).toContain('+9 damages (1 turn)')
  expect(text).toContain('−2 Ap (2 turns)')
  expect(html).not.toContain(' · ')
  expect(html).not.toContain('fight-hud__effect')
  expect(html).not.toContain('cast_cost')
  expect(html).toContain('ent-tt__delta--crit')
})
