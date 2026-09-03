// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppCopy } from '../../../src/i18n/copy.ts'
import { FightSimulatorExit } from '../../../src/game/fight/FightLayer.tsx'

const copy = { simulator_page: { back_to_setup: 'Back to setup' } } as unknown as AppCopy

test('the Fight Lab exit opts back into pointer input over the click-through fight layer', () => {
  const html = renderToStaticMarkup(<FightSimulatorExit copy={copy} visible />)

  expect(html).toContain('Back to setup')
  expect(html).toContain('pointer-events-auto')
})

test('the Fight Lab exit stays absent from remote fights', () => {
  expect(renderToStaticMarkup(<FightSimulatorExit copy={copy} visible={false} />)).toBe('')
})
