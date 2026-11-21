// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const css = readFileSync(join(import.meta.dir, '../../src/components/app_layout.css'), 'utf8')

// Regression (owner report 2026-11-22): the rule that anchors the wallet card under its chip was written
// for every page, and in the 3D game it threw the card to the left edge of the window. The game's chip
// sits in the HUD corner and keeps the corner rule; only a light page anchors the card to its chip.
test('the wallet card is anchored to its chip on a light page only; the game HUD keeps its corner', () => {
  const anchored = [...css.matchAll(/([^{}]+)\{[^{}]*anchor\(/g)].map(([, selector]) => selector!.trim())
  expect(anchored.length).toBeGreaterThan(0)
  for (const selector of anchored) expect(selector).toBe('.light-page .wallet-popover')
  expect(css).toMatch(/\n\.wallet-popover \{\n {2}position: fixed;\n {2}inset: calc\(var\(--app-top/)
})
