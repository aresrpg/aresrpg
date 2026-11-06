// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MarketSourceContext } from '../../src/marketplace/MarketSource.tsx'
import { character_listing, useMarketSell } from '../../src/marketplace/useMarketSell.ts'
import { initial_app_state } from '../../src/store.ts'
import { character } from '../modules/automation_fixture.ts'

const SelectionProbe = () => (
  <span>
    {useMarketSell()
      .characters.map(({ id }) => id)
      .join(',')}
  </span>
)

test('selling accepts naked level-one characters but excludes equipment, fight custody and existing listings', () => {
  const base = initial_app_state({ quality: 'medium', music_enabled: false, render_distance: null })
  const naked = { ...character(), id: 'level_one', equipment: [] }
  const veteran = { ...naked, id: 'level_thirty', level: 30 }
  const listed = { ...naked, id: 'listed' }
  const markup = renderToStaticMarkup(
    <MarketSourceContext.Provider
      value={{
        market: { ...base.marketplace, own_listings: [{ ...character_listing(listed, 'owner', 1n), version: '1' }] },
        account: {
          ...base.session,
          characters: [
            naked,
            veteran,
            { ...character(), id: 'equipped' },
            { ...naked, id: 'fighting', custody: 'fight' },
            listed,
          ],
        },
        dispatch: () => undefined,
        craft_session: { character: naked },
      }}
    >
      <SelectionProbe />
    </MarketSourceContext.Provider>
  )
  expect(markup).toBe('<span>level_one,level_thirty</span>')
})
