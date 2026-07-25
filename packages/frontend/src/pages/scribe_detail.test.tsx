// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scribe_detail.test.tsx — RED-FIRST regression: the runeforge LEFT card (scribe.tsx) must render the
// selected gear's REAL rolled stats, not the template catalog's permanently-hardcoded '{}' (prod
// regression, live v35 — see scribe_detail.ts for the full diagnosis). Proven DOM-less
// (renderToStaticMarkup, no jsdom — the item_detail_view.test.tsx idiom) through the EXACT production
// function scribe.tsx calls (scribe_detail_props), split into its own leaf file so importing it never drags
// in scribe.tsx's `../auth` (registerEnokiWallets crashes at module load without a `window`).

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'

import en from '../i18n/locales/en.json'
import { ItemDetailView } from '../components/item_detail_view'

import { scribe_detail_props, type Item } from './scribe_detail'

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

const tt = ((tmpl: any, field: string) => tmpl?.[field] ?? '') as any

// The EXACT shape get_template_by_item_type_map() (read_findables.js) serves in production today —
// statsJson is ALWAYS the literal '{}' (line 44's self-documented indexer omission), never real numbers.
const TEMPLATE_MAP = new Map([
  [
    'iron_sword',
    { id: '0xtmpl', name: 'Iron Sword', item_type: 'iron_sword', category: 'sword', level: 12, statsJson: '{}' },
  ],
])

const SEL_GEAR: Item = {
  id: '0xitem',
  item_type: 'iron_sword',
  item_category: 'sword',
  name: 'Iron Sword',
  level: 12,
  amount: 1,
}

const render_card = (props: any) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <ItemDetailView item={props} />
    </I18nextProvider>
  )

describe("scribe_detail_props — the runeforge card shows the gear's REAL rolled stats", () => {
  test('honest empty: before the rolled-stats read lands, the CHARACTERISTICS section is ABSENT (never fabricated, never a bare empty header — #315)', () => {
    const props = scribe_detail_props(SEL_GEAR, TEMPLATE_MAP, null, tt)
    const html = render_card(props)
    // gear_stats null → the template's honest '{}' → no non-zero stats → ItemDetailView drops the whole
    // CHARACTERISTICS section (issue #315: never a bare header over an empty body — see
    // components/item_detail_view.tsx has_characteristics + item_detail_view.test.tsx line 184). The prior
    // assertion expected an empty-rows header, which #315 deleted; the honest-empty CONTRACT (no fabricated
    // stat) is unchanged and still asserted below.
    expect(html).not.toContain('CHARACTERISTICS')
    expect(html).not.toContain('Vitality')
  })

  test("BUG->FIX: the item's real rolled stats (sdk.get_rolled_stats) render as non-empty CHARACTERISTICS rows", () => {
    const rolled_stats = { vitality: 32783, agility: 32776 } // centered u16 values from item_stats::StatsKey
    const props = scribe_detail_props(SEL_GEAR, TEMPLATE_MAP, rolled_stats, tt)
    const html = render_card(props)
    expect(props?.stats).toEqual({ vitality: [15, 15], agility: [8, 8] })
    expect(html).toContain('CHARACTERISTICS')
    expect(html).toContain('+15')
    expect(html).toContain('Vitality')
    expect(html).toContain('+8')
    expect(html).toContain('Agility')
    expect(html).not.toContain('32783')
    expect(html).not.toContain('32776')
  })
})
