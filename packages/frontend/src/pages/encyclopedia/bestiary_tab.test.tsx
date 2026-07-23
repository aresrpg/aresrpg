// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression: mob resistances are stored on-chain CENTERED @32768 (spell.move RES_SHIFT — the
// same convention item_stats.move's ItemStatistics uses; packages/move/foundation/sources/spell.move
// decenter_mob_resistances). A live testnet boar's ACTUAL wire stats — earth=32808 water=32768
// air=32748 (fire=32768, neutral) — pin the exact numbers: decode_mob_resist must turn each wire int into
// its real signed delta (+40 / 0 / -20 / 0), and MobDetailView must render those decoded values, never the
// raw centered int leaking to the DOM.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import en from '../../i18n/locales/en.json'
import { MobDetailView } from '../../components/mob_detail_view'

import { decode_mob_resist } from './bestiary_tab'

const test_i18n = i18next.createInstance()
test_i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// The live boar's actual on-chain wire values (content house, verified against live testnet).
const WIRE_BOAR = { earth: 32808, water: 32768, air: 32748, fire: 32768 }

test('decode_mob_resist turns the live boar wire ints into real signed deltas', () => {
  expect(decode_mob_resist(WIRE_BOAR.earth)).toBe(40)
  expect(decode_mob_resist(WIRE_BOAR.water)).toBe(0)
  expect(decode_mob_resist(WIRE_BOAR.air)).toBe(-20)
  expect(decode_mob_resist(WIRE_BOAR.fire)).toBe(0)
  // absent field (the §14 index doesn't project this today) stays an honest unknown, never a fabricated 0.
  expect(decode_mob_resist(null)).toBe(null)
  expect(decode_mob_resist(undefined)).toBe(null)
})

test('MobDetailView renders the DECODED resist signs, never the raw wire int', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MobDetailView
        mob={{
          name: 'Boar',
          icon_name: 'Boar',
          element: 'EARTH',
          minLevel: 1,
          maxLevel: 4,
          health: 40,
          xpReward: null,
          isBoss: false,
          stats: {},
          resistances: {
            earth: decode_mob_resist(WIRE_BOAR.earth) ?? 0,
            water: decode_mob_resist(WIRE_BOAR.water) ?? 0,
            air: decode_mob_resist(WIRE_BOAR.air) ?? 0,
            fire: decode_mob_resist(WIRE_BOAR.fire) ?? 0,
          },
          drops: [],
          found_in: [],
        }}
        show_stats={false}
      />
    </I18nextProvider>
  )
  expect(html).toContain('+40%') // earth resist, decoded
  expect(html).toContain('>-20%') // air weakness, decoded (the red #f87171 stat-card idiom)
  // The raw centered wire ints must never reach the DOM — this is the exact bug: a player seeing "32808"
  // (or a huge/overflowing bar) instead of "+40".
  expect(html).not.toContain('32808')
  expect(html).not.toContain('32748')
})
