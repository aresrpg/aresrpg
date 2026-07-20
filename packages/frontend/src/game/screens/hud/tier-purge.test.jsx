// NO QUALITY TIERS (regression: the pet unseal card once
// printed "UNCOMMON"): tier vocabulary must NEVER reach the DOM — no badge text, no data-quality
// hook, no q-<tier> class. Items still carry a residual `quality`/`rarity` template field (inert
// data until the seed-purge ticket); every render surface must stay blind to it.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'bun:test'

import { ItemCard } from './ItemCard.jsx'
import { to_item_view } from './item-view.js'

const residual_item = {
  id: '0xitem',
  name: 'Modni Lyk',
  category: 'pet',
  level: 3,
  quality: 'uncommon', // residual template field — must never render
  rarity: 'uncommon',
}

describe('quality-tier purge', () => {
  test('ItemCard markup carries zero tier vocabulary for an item with a residual quality field', () => {
    const html = renderToStaticMarkup(<ItemCard item={residual_item} />)
    expect(html).not.toMatch(/uncommon|legendary|epic|rarity|data-quality/i)
  })

  test('the normalized ItemView exposes no quality field for tier-curious consumers', () => {
    const view = to_item_view(residual_item)
    expect(Object.keys(view)).not.toContain('quality')
  })
})
