// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST render proof (ency deep-links): the DungeonsModal need_key sentence rendered PLAIN
// TEXT at HEAD; now the key name is an <a> to its encyclopedia item page (via the ONE idiom, EncyclopediaLink +
// the Trans <link> slot). No browser — server static render (react-dom/server), the world_tab.test precedent.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import i18next from 'i18next'
import { I18nextProvider, Trans, initReactI18next } from 'react-i18next'

import { EncyclopediaLink } from './EncyclopediaLink'

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: { need_key: 'You need a <link>{{key}}</link> to enter.' } } },
  interpolation: { escapeValue: false },
})

const need_key_markup = (key_id: string | null) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Trans
          i18nKey="need_key"
          values={{ key: 'Key of the First Shore' }}
          components={{ link: <EncyclopediaLink kind="item" id={key_id} /> }}
        />
      </I18nextProvider>
    </MemoryRouter>
  )

describe('need_key deep-link render (was plain text at HEAD)', () => {
  test('a resolved key id → the key name is an <a> to /encyclopedia/items/:id, sentence intact', () => {
    const html = need_key_markup('0xKEY')
    expect(html).toContain('href="/encyclopedia/items/0xKEY"')
    expect(html).toContain('Key of the First Shore')
    expect(html).toContain('You need a')
    expect(html).toContain('to enter.')
  })

  test('no resolvable key id → the key name stays plain text (never a dead /.../null link)', () => {
    const html = need_key_markup(null)
    expect(html).not.toContain('/encyclopedia/items/')
    expect(html).toContain('Key of the First Shore')
    expect(html).toContain('You need a')
  })
})

describe('EncyclopediaLink world reference — the world-picker counts link', () => {
  test('a world id → an <a> to /encyclopedia/worlds/:id wrapping its children', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EncyclopediaLink kind="world" id="0xWORLD">
          <span>3 mobs</span>
        </EncyclopediaLink>
      </MemoryRouter>
    )
    expect(html).toContain('href="/encyclopedia/worlds/0xWORLD"')
    expect(html).toContain('3 mobs')
  })
})
