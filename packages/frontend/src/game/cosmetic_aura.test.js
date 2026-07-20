// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COSMETIC → AURA map: owner-pinned crowns, faithful STATUS_OVERLAY keys, and drift-proof coverage of the
// generator SSOT (seed/mainnet/shop.json). Plus the equipped-slug resolver the roam avatar drives.
import { readFileSync } from 'node:fs'

import { describe, expect, it, test } from 'bun:test'

import { STATUS_OVERLAY } from '@aresrpg/engine3/vfx'

import { COSMETIC_AURA, aura_of_item, resolve_cosmetic_aura } from './cosmetic_aura.js'

const shop = JSON.parse(readFileSync(new URL('../../../../seed/mainnet/shop.json', import.meta.url), 'utf8'))

describe('COSMETIC_AURA — the slug → status-overlay map', () => {
  test('the pinned reserved crowns carry their declared colours', () => {
    expect(COSMETIC_AURA.sui_helmet).toBe('water') // owner: the sui helmet gets a blue aura
    expect(COSMETIC_AURA.suicunio).toBe('purple') // owner: the suicunio a purple one
    expect(COSMETIC_AURA.sam).toBe('glow') // the third reserved crown (the remaining pack aura)
  })

  test('every mapped aura resolves to a real engine STATUS_OVERLAY colour', () => {
    for (const [slug, key] of Object.entries(COSMETIC_AURA))
      expect(STATUS_OVERLAY[key], `${slug} → ${key} must be a STATUS_OVERLAY key`).toBeDefined()
  })

  test('every shop cosmetic that carries an `aura` in the seed SSOT is covered by the map', () => {
    const seeded = shop.cosmetics.filter((c) => c.aura)
    expect(seeded.length).toBeGreaterThanOrEqual(15) // the 15 sellable prestige rows
    for (const c of seeded) expect(COSMETIC_AURA[c.slug], `shop slug '${c.slug}' (aura ${c.aura}) unmapped`).toBeDefined()
  })

  test('the seed aura equals the mapped key 1:1, except the documented gem→shard borrow', () => {
    for (const c of shop.cosmetics.filter((x) => x.aura)) {
      const expected = c.aura === 'gem' ? 'shard' : c.aura // no gem_overlay.tres in the pack
      expect(COSMETIC_AURA[c.slug], `${c.slug}`).toBe(expected)
    }
  })
})

describe('resolve_cosmetic_aura — the live equipped-cosmetic read', () => {
  it('reads a mapped item off the hat slot', () => {
    expect(resolve_cosmetic_aura({ hat: { template_id: 'coiffe_pepe_royal' } })).toBe('divine')
  })

  it('reads a mapped cloak', () => {
    expect(resolve_cosmetic_aura({ cloak: { template_id: 'cape_kamui' } })).toBe('void')
  })

  it('the head crown wins over the cloak (precedence)', () => {
    const character = { hat: { template_id: 'sui_helmet' }, cloak: { template_id: 'cape_kamui' } }
    expect(resolve_cosmetic_aura(character)).toBe('water')
  })

  it('an unmapped cosmetic (or none) yields null', () => {
    expect(resolve_cosmetic_aura({ hat: { template_id: 'parrot_hat' } })).toBeNull()
    expect(resolve_cosmetic_aura({})).toBeNull()
    expect(resolve_cosmetic_aura(null)).toBeNull()
  })

  it('falls back through identity fields, and the slot word item_type never false-matches', () => {
    expect(aura_of_item({ slug: 'berserk', item_type: 'hat' })).toBe('flame')
    expect(aura_of_item({ item_type: 'hat' })).toBeNull() // 'hat' is a slot word, never a map key
    expect(aura_of_item(null)).toBeNull()
  })
})
