// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import de from '../src/i18n/locales/de.yaml'
import en from '../src/i18n/locales/en.yaml'
import es from '../src/i18n/locales/es.yaml'
import fr from '../src/i18n/locales/fr.yaml'
import ja from '../src/i18n/locales/ja.yaml'
import uk from '../src/i18n/locales/uk.yaml'

test('all six authored locale documents carry the same keys', () => {
  const expected = Object.keys(en).sort()
  for (const document of [de, es, fr, ja, uk]) expect(Object.keys(document).sort()).toEqual(expected)
})

test('the simulator surface ships every string in all six locales', () => {
  const expected = Object.keys(en.simulator_page).sort()
  for (const document of [de, es, fr, ja, uk]) expect(Object.keys(document.simulator_page).sort()).toEqual(expected)
})
