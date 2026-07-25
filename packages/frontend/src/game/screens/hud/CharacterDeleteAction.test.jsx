// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'

import { CharacterDeleteAction } from './CharacterDeleteAction.jsx'

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const render_action = (block_reason = null, busy = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <CharacterDeleteAction block_reason={block_reason} busy={busy} on_delete={() => {}} />
    </I18nextProvider>
  )

describe('CharacterDeleteAction — disabled with an accessible reason', () => {
  test('a blocked action leaves a focusable tooltip trigger carrying the exact reason', () => {
    const reason = 'Unequip all items before deleting'
    const html = render_action(reason)
    expect(html).toContain('class="chrx-row__del-trigger"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain(`aria-label="${reason}"`)
    expect(html).toMatch(/<button[^>]*class="chrx-row__del"[^>]*disabled=""/)
  })

  test('an allowed action remains a normal enabled button', () => {
    const html = render_action()
    expect(html).not.toContain('tabindex="0"')
    expect(html).toContain('aria-label="Delete character"')
    expect(html).not.toContain('disabled=""')
  })
})
