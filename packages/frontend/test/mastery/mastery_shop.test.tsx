// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MasteryShop } from '../../src/mastery/MasteryShop.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import * as store from '../../src/store.ts'

test('each Mastery card offers both currencies with independent affordability and shared pending protection', async () => {
  const copy = await load_app_copy('en')
  const base = store.initial_app_state({
    quality: 'medium',
    flat_mode: false,
    music_enabled: true,
    render_distance: null,
  })
  const offer = content_catalog.mastery.offers.find((row) => row.item)!
  for (const scenario of [
    { points: '0', kares: 3_000_000_000n, pending: null, mastery_disabled: true, kares_disabled: false },
    { points: '3', kares: 0n, pending: null, mastery_disabled: false, kares_disabled: true },
    {
      points: '3',
      kares: 3_000_000_000n,
      pending: `redeem:${offer.item_type}`,
      mastery_disabled: true,
      kares_disabled: true,
    },
  ]) {
    const state = {
      ...base,
      session: {
        ...base.session,
        wallet: { address: '0xowner' } as never,
        link_status: 'ready' as const,
        current_epoch: '1',
        kares_balance: scenario.kares,
      },
      mastery: {
        ...base.mastery,
        pending: scenario.pending,
        row: { points: scenario.points } as never,
        offers: [{ id: 'offer', template: 'template', item_type: offer.item_type, cost: '2', enabled: true }],
      },
    }
    const select = spyOn(store, 'useAppStore').mockImplementation(<T,>(selector: (value: store.AppState) => T): T =>
      selector(state)
    )
    try {
      const html = renderToStaticMarkup(<MasteryShop copy={copy} />)
      expect(html).not.toContain('type="radio"')
      expect(html).not.toContain(copy.kares_page.payment)
      const buttons = [...html.matchAll(/<button[^>]*data-mastery-payment="(mastery|kares)"[^>]*>/g)]
      expect(buttons).toHaveLength(2)
      expect(buttons[0][0].includes('disabled=""')).toBe(scenario.mastery_disabled)
      expect(buttons[1][0].includes('disabled=""')).toBe(scenario.kares_disabled)
    } finally {
      select.mockRestore()
    }
  }
})
