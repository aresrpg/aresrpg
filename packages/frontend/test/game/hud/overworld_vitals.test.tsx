// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EmptyActionCells, ExperienceBar } from '../../../src/game/hud/OverworldVitals.tsx'

test('the overworld action bar keeps ten empty cells', () => {
  const html = renderToStaticMarkup(<EmptyActionCells />)

  expect(html.match(/data-empty-action-cell/g)).toHaveLength(10)
})

test('the overworld vitals show progress within the selected character level', () => {
  const html = renderToStaticMarkup(<ExperienceBar experience="380" />)

  expect(html).toContain('aria-label="270 / 540 XP"')
  expect(html).toContain('width:50%')
})
