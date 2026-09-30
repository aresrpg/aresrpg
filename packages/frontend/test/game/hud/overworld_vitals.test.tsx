// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { render_english as renderToStaticMarkup } from '../../i18n/render.ts'
import { character_max_hp, projected_hp } from '../../../src/game/character_stats.ts'
import { ExperienceBar } from '../../../src/game/hud/OverworldVitals.tsx'
import { vital_percent, VitalsDisplay } from '../../../src/game/hud/VitalsDisplay.tsx'

test('the HP display supplies the exact bounded remaining percentage to the shared heart', () => {
  const html = renderToStaticMarkup(<VitalsDisplay ap={6n} hp={19n} max_hp={55n} mp={3n} />)

  expect(vital_percent(19n, 55n)).toBe(34.54)
  expect(html).toContain('--hp-percent:34.54%')
  expect(vital_percent(0n, 55n)).toBe(0)
  expect(vital_percent(60n, 55n)).toBe(100)
  expect(vital_percent(0n, 0n)).toBe(0)
})

test('the overworld vitals show progress within the selected character level', () => {
  const html = renderToStaticMarkup(<ExperienceBar experience="380" />)

  expect(html).toContain('aria-label="270 / 540 XP"')
  expect(html).toContain('width:50%')
  expect(html).toContain('>270 / 540 XP<')
})

test('gathering XP uses the job curve and names the profession', () => {
  const html = renderToStaticMarkup(<ExperienceBar experience="95" job="FARMER" />)
  expect(html).toContain('aria-label="Farmer · 45 / 90 XP"')
  expect(html).toContain('aria-valuenow="50"')
  expect(html).toContain('fight-hud__experience--job')
})

test('a max-level profession displays a full bar', () => {
  const html = renderToStaticMarkup(<ExperienceBar experience="581687" job="FARMER" />)
  expect(html).toContain('aria-valuenow="100"')
  expect(html).not.toContain('NaN')
})

test('a projected level-up fills HP against the new level and all vitality bonuses', () => {
  const character = {
    level: 2,
    vitality: 7,
    folded_stats: { vitality: 32788 },
    hp: '87',
    hp_ms: 1250,
  } as unknown as CharacterRow
  const max_hp = character_max_hp(character)
  const hp = projected_hp(character, 1250)
  expect({ hp, max_hp }).toEqual({ hp: 87, max_hp: 87 })
  const html = renderToStaticMarkup(<VitalsDisplay ap={6n} hp={BigInt(hp)} max_hp={BigInt(max_hp)} mp={3n} />)
  expect(html).toContain('87 / 87 HP')
  expect(html).toContain('--hp-percent:100%')
})
