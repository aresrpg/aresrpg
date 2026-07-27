// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The off-turn action gate is safety copy, not decoration: every supported locale must name the chain-anchored
// active fighter so a client can never invite a doomed spend while somebody else owns the turn.
import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('i18n · fight.waiting_for names the turn owner in all six locales', () => {
  test.each(LOCALES)('%s.json carries and interpolates the same named waiting gate', async (lang) => {
    const translation = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    const template = translation?.fight?.waiting_for
    expect(typeof template).toBe('string')
    expect(template.trim()).not.toBe('')
    expect(template).toContain('{{name}}')

    const i18n = i18next.createInstance()
    await i18n.init({
      lng: lang,
      resources: { [lang]: { translation } },
      interpolation: { escapeValue: false },
    })
    const rendered = i18n.t('fight.waiting_for', { name: 'Aster' })
    expect(rendered).toContain('Aster')
    expect(rendered).not.toContain('{{name}}')
  })
})
