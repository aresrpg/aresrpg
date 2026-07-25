// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../../../i18n/locales/en.json'

import { CharacterDeleteConfirm, delete_confirm_ready } from './CharacterDeleteConfirm.jsx'

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const render_confirm = (busy = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <CharacterDeleteConfirm
        character={{ id: '0xc1', name: 'Testa' }}
        busy={busy}
        on_cancel={() => {}}
        on_confirm={() => {}}
      />
    </I18nextProvider>
  )

describe('CharacterDeleteConfirm — irrecoverability acknowledgement', () => {
  test('arms only after acknowledgement and disarms again while executing', () => {
    expect(delete_confirm_ready(false, false)).toBe(false)
    expect(delete_confirm_ready(true, false)).toBe(true)
    expect(delete_confirm_ready(true, true)).toBe(false)
  })

  test('names the character and asks for a checkbox acknowledgement, never typed text', () => {
    const html = render_confirm()
    expect(html).toContain('Testa')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('type="text"')
    expect(html).toContain('I understand that Testa will be permanently deleted and cannot be recovered.')
  })

  test('starts with the destructive action disabled until acknowledgement', () => {
    const html = render_confirm()
    expect(html).toMatch(/<button[^>]*class="chr-confirm__del"[^>]*disabled=""[^>]*>Delete forever<\/button>/)
  })

  test('locks the acknowledgement while the transaction is executing', () => {
    const html = render_confirm(true)
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/)
    expect(html).toContain('Deleting…')
  })
})
