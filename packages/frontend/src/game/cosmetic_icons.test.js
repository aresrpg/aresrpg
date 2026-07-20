// COSMETIC_ICON map: drift-proof coverage of the generator SSOT (seed/mainnet/shop.json) + the resolver
// that fixes "cosmetics don't show in the wiki" (broken item_type-as-slot-word icon urls).
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { COSMETIC_ICON, cosmetic_icon_of } from './cosmetic_icons.js'

const shop = JSON.parse(readFileSync(new URL('../../../../seed/mainnet/shop.json', import.meta.url), 'utf8'))
const rows = [...(shop.cosmetics ?? []), ...(shop.pets ?? [])]

describe('COSMETIC_ICON — the slug|name → real icon slug map', () => {
  test('every shop cosmetic/pet row is covered, by BOTH its slug and its name', () => {
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(COSMETIC_ICON[r.slug], `slug '${r.slug}' unmapped`).toBe(r.icon)
      expect(COSMETIC_ICON[r.name], `name '${r.name}' unmapped`).toBe(r.icon)
    }
  })

  test('no generic slot word (itemType) ever appears as a map key', () => {
    const slot_words = new Set(rows.map((r) => r.itemType))
    for (const word of slot_words)
      expect(COSMETIC_ICON[word], `slot word '${word}' must never be a key`).toBeUndefined()
  })
})

describe('cosmetic_icon_of — the resolver', () => {
  test('resolves by slug', () => {
    expect(cosmetic_icon_of({ slug: 'cape_lorito_agility' })).toBe('cape_lorito-agility')
  })

  test('resolves by name (the /v1 encyclopedia item row shape — no slug/icon field)', () => {
    expect(cosmetic_icon_of({ template_id: '0xabc', item_type: 'cloak', name: 'Lorito Cloak (Emerald)' })).toBe(
      'cape_lorito-agility'
    )
  })

  test('delisted-but-worn cosmetics (living manifest annex rows beyond the shop seed) resolve to their real art', () => {
    // /v1 `worn` row shape: no slug/icon, item_type = the slot word — the Display name is the only identity.
    // The Opal cloak is DELISTED from seed/mainnet/shop.json but still worn on-chain; without its annex row
    // the resolver returns null and the caller falls through to items/cloak.png → 404 → generic slot glyph.
    expect(cosmetic_icon_of({ template_id: '0xb9b0fb61', item_type: 'cloak', name: 'Lorito Cloak (Opal)' })).toBe(
      'cape_lorito-air'
    )
    expect(cosmetic_icon_of({ slug: 'cape_lorito_water', name: 'Lorito Cloak (Aquamarine)' })).toBe('cape_lorito-water')
  })

  test('recovers the legacy Lorito listing whose runtime identity is a Sui object address', () => {
    expect(
      cosmetic_icon_of({
        id: '0x2521c902ae440a18c3cfd7ca5906b17d6ad6c3d754054c37d861c6b86938d80d',
        name: 'Lorito Cloak (Chance)',
      })
    ).toBe('cape_lorito-chance')
  })

  test('the slot word (item_type) never false-matches, even when tried', () => {
    expect(cosmetic_icon_of({ item_type: 'hat', name: 'Some Unmapped Item' })).toBeNull()
  })

  test('a non-cosmetic item (no match on any field) yields null — caller keeps its own fallback', () => {
    expect(cosmetic_icon_of({ id: 'bag_diamond', item_type: 'bag', name: 'Bag of Diamonds' })).toBeNull()
    expect(cosmetic_icon_of(null)).toBeNull()
    expect(cosmetic_icon_of(undefined)).toBeNull()
  })
})
