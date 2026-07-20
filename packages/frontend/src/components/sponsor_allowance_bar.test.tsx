import { describe, expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../i18n/locales/en.json'

import { GasSpentLine } from './gas_spent_line'

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

describe('GasSpentLine', () => {
  test('renders the translated rolling-window label and exact self-paid total', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={test_i18n}>
        <GasSpentLine spent_mist={2_500_000n} />
      </I18nextProvider>
    )

    expect(html).toContain('Gas spent (24h)')
    expect(html).toContain('&lt;0.01 SUI') // 2dp card format; sub-cent spend floors to <0.01, never a false 0.00
  })
})
