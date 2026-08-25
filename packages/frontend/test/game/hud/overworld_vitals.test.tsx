// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EmptyActionCells, ExperienceBar } from '../../../src/game/hud/OverworldVitals.tsx'
import { vital_percent, VitalsDisplay } from '../../../src/game/hud/VitalsDisplay.tsx'

test('the HP hex drains downward and exposes its exact remaining fill', () => {
  const html = renderToStaticMarkup(<VitalsDisplay ap={6n} hp={19n} max_hp={55n} mp={3n} />)
  const css = readFileSync(new URL('../../../src/game/fight/fight_hud.css', import.meta.url), 'utf8')

  expect(vital_percent(19n, 55n)).toBe(34.54)
  expect(html).toContain('--hp-percent:34.54%')
  expect(css).toMatch(/bottom:\s*0;[\s\S]*height:\s*var\(--hp-percent\)/)
})

test('the overworld action bar keeps ten empty cells', () => {
  const html = renderToStaticMarkup(<EmptyActionCells />)

  expect(html.match(/data-empty-action-cell/g)).toHaveLength(10)
})

test('the overworld vitals show progress within the selected character level', () => {
  const html = renderToStaticMarkup(<ExperienceBar experience="380" />)
  const css = readFileSync(new URL('../../../src/game/fight/fight_hud.css', import.meta.url), 'utf8')

  expect(html).toContain('aria-label="270 / 540 XP"')
  expect(html).toContain('width:50%')
  expect(html).toContain('>270 / 540 XP<')
  expect(css).toMatch(/\.fight-hud__bar--overworld\s*\{[^}]*flex-direction:\s*column/)
  expect(css).toMatch(/\.fight-hud__overworld-row\s*\{[^}]*display:\s*flex/)
  expect(css).toMatch(/\.fight-hud__experience-fill\s*\{[^}]*#f59e0b/)
  expect(css).not.toContain('#d4e157')
})
