import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import en from '../../i18n/locales/en.json'

import { RosterChip } from './world_tab'

const EN = i18next.createInstance()
EN.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const mob = { id: '0xabc', name: 'Alley Bunny', element: 'earth', role: 'trash', minLevel: 1, maxLevel: 4 }
const render = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={EN}>
      <RosterChip mob={mob} />
    </I18nextProvider>
  )

test('the world roster mob icon uses the encyclopedia walrus home — never the forbidden /sprites fallback', () => {
  // Encyclopedia law (encyclopedia_assets.ts): the `mob_icon` quilt is the ONLY permitted origin; the
  // generic components/mob_image `/sprites/…` fallback must never reach the browser. With the quilt
  // unconfigured the ency home degrades to a shield — the generic component leaked a /sprites <img> (HEAD).
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: {} })
  expect(render()).not.toContain('/sprites/')
})

test('with the mob_icon quilt configured, the roster shows the resolved walrus icon (one home with the bestiary)', () => {
  configure_walrus_assets({ aggregator: 'https://agg.example', classes: { mob_icon: { quilt: 'q' } } })
  const html = render()
  expect(html).toContain('<img')
  expect(html).toContain('agg.example/v1/blobs/by-quilt-id/q/')
})
