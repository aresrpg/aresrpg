// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #526 RED-FIRST: characters with pet_equipped:true (repro slugs pet_bouloute / pet_modni_lyk) got NO world
// companion. Root cause (verified live against testnet + the published Walrus quilts, not guesswork): the old
// resolve_pet_companion resolved appearance through cosmetic_glb_url's `<slug>.glb` COSMETIC-quilt convention
// — but no pet's art was EVER published there (every real pet slug 404s against it). The fix resolves through
// the SAME two published catalogs mob rendering already uses — never a speculative cosmetic-quilt guess.
//
// This file (unlike pet_companion.test.js) carries no @aresrpg/engine3 import, so it runs in every checkout,
// including this public one where the private character GLB (issue #117) is absent — the resolver split's
// whole point.
import { afterEach, describe, expect, test } from 'bun:test'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import { get_log_buffer, _reset_log_for_test } from '../core/log.js'
import { set_pet_catalog_for_test } from './data/pet_catalog.js'
import { set_catalog_for_test as set_mob_catalog_for_test } from './data/mob_catalog.js'
import { resolve_pet_companion, resolve_pet_model_url } from './pet_companion_resolver.js'

const MOB_QUILT = 'mob-test'
const mob_url = (glb) => `https://cdn.test/walrus/v1/blobs/by-quilt-id/${MOB_QUILT}/${glb}.glb`

configure_walrus_assets({ aggregator: 'https://cdn.test/walrus', classes: { mob: { quilt: MOB_QUILT } } })

afterEach(() => {
  set_pet_catalog_for_test()
  set_mob_catalog_for_test()
  _reset_log_for_test()
})

describe('resolve_pet_model_url — the #526 root-cause fix (catalog join, never the cosmetic-quilt guess)', () => {
  test('the two live #526 repro slugs (pet_bouloute / pet_modni_lyk): no pet_catalog row, resolve via the ALREADY-LIVE mob catalog with the pet_ prefix stripped', () => {
    // The exact published mob_catalog.json rows (verified live on testnet, 2026-07-23): pets that predate the
    // Hytale-33 pet_catalog are published under the mob catalog, keyed WITHOUT the item's `pet_` slug prefix.
    set_mob_catalog_for_test({
      bouloute: { appearance: 'Lamb', glb: 'hy_lamb' },
      modni_lyk: { appearance: 'Cat_Viki', glb: 'hy_cat_viki' },
    })
    expect(resolve_pet_model_url('pet_bouloute')).toBe(mob_url('hy_lamb'))
    expect(resolve_pet_model_url('pet_modni_lyk')).toBe(mob_url('hy_cat_viki'))
  })

  test('a locked Hytale-33 slug resolves catalog-first through pet_catalog (exact slug match)', () => {
    set_pet_catalog_for_test({ pet_aloe_gaia: { appearance: 'Armadillo_Aloe', glb: 'hy_armadillo_aloe' } })
    expect(resolve_pet_model_url('pet_aloe_gaia')).toBe(mob_url('hy_armadillo_aloe'))
  })

  test('a mob_catalog row keyed WITH the pet_ prefix (pet_siluri, a real published row) matches exactly — never double-stripped', () => {
    set_mob_catalog_for_test({ pet_siluri: { appearance: 'Tortoise', glb: 'hy_tortoise' } })
    expect(resolve_pet_model_url('pet_siluri')).toBe(mob_url('hy_tortoise'))
  })

  test('pet_catalog wins over a same-keyed mob_catalog fallback (the locked roster is authoritative)', () => {
    set_pet_catalog_for_test({ pet_gaia: { appearance: 'Armadilla_Gaia', glb: 'hy_armadilla_gaia' } })
    set_mob_catalog_for_test({ gaia: { appearance: 'Wrong', glb: 'hy_wrong' } })
    expect(resolve_pet_model_url('pet_gaia')).toBe(mob_url('hy_armadilla_gaia'))
  })

  test('no row in either catalog -> null, and the miss is logged honestly (naming the slug, never silent)', () => {
    expect(resolve_pet_model_url('pet_nonexistent')).toBeNull()
    const entries = get_log_buffer()
    expect(entries).toHaveLength(1)
    expect(entries[0].ns).toBe('pet')
    expect(entries[0].message).toContain('pet_nonexistent')
  })

  test('a repeated miss on the SAME slug logs once (deduped — this resolves every frame)', () => {
    // A slug unique to THIS test: warned_slugs is a module-level (session-lifetime) dedup set with no
    // test-reset seam by design (mirrors mobs.js's warned_appearances) — a shared slug would silently
    // inherit an earlier test's warned state.
    resolve_pet_model_url('pet_dedup_probe_only_here')
    resolve_pet_model_url('pet_dedup_probe_only_here')
    resolve_pet_model_url('pet_dedup_probe_only_here')
    expect(get_log_buffer()).toHaveLength(1)
  })

  test('a catalog row with glb: null is treated as absent, never a speculative request', () => {
    set_pet_catalog_for_test({ pet_ghost: { appearance: 'ghost', glb: null } })
    expect(resolve_pet_model_url('pet_ghost')).toBeNull()
  })
})

describe('resolve_pet_companion — spawn/despawn verdict (the pure decision shape, hermetic via an injected resolver)', () => {
  test('pet_equipped + a slug sibling -> spawn, glb from the injected resolver', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      '',
      (slug) => `https://cdn.test/mob/${slug}.glb`
    )
    expect(r).toEqual({ spawn: true, glb_url: 'https://cdn.test/mob/pet_bouloute.glb', key: 'pet_bouloute' })
  })

  test('an unresolvable slug (the injected resolver misses) -> no-spawn, never a placeholder', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } },
      '',
      () => null
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped: false -> never consults the resolver, even if a stale `pet` object is present', () => {
    const resolve_model = () => {
      throw new Error('resolver must not run for an unequipped pet')
    }
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: false, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      '',
      resolve_model
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped: true + pet: null (the honest identity-snapshot-gap contract) -> no placeholder spawn', () => {
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: true, pet: null }, '', () => 'must-not-resolve')
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped: true + a slug-less pet shape -> never spawns (no guessed identity)', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004' } },
      '',
      () => 'must-not-resolve'
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('no pet slot / null / undefined character -> never spawns, never throws', () => {
    const never = () => 'must-not-resolve'
    expect(resolve_pet_companion({ id: 'c1' }, '', never)).toEqual({ spawn: false, glb_url: null, key: null })
    expect(resolve_pet_companion(null, '', never)).toEqual({ spawn: false, glb_url: null, key: null })
    expect(resolve_pet_companion(undefined, '', never)).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('a switch to a different equipped pet re-keys (the caller diffs glb_url to recreate the rig)', () => {
    const resolve_model = (slug) => `https://cdn.test/mob/${slug}.glb`
    const bouloute = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa', template_id: '0xb', slug: 'pet_bouloute' } },
      '',
      resolve_model
    )
    const modni = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xc', template_id: '0xd', slug: 'pet_modni_lyk' } },
      '',
      resolve_model
    )
    expect(bouloute.glb_url).not.toBe(modni.glb_url)
    expect(modni).toEqual({ spawn: true, glb_url: 'https://cdn.test/mob/pet_modni_lyk.glb', key: 'pet_modni_lyk' })
  })

  test('end-to-end with the REAL default resolver + the two live #526 repro slugs, no injection', () => {
    set_mob_catalog_for_test({
      bouloute: { appearance: 'Lamb', glb: 'hy_lamb' },
      modni_lyk: { appearance: 'Cat_Viki', glb: 'hy_cat_viki' },
    })
    const r = resolve_pet_companion({
      id: 'c1',
      pet_equipped: true,
      pet: { item_id: '0xa004', template_id: '0x62cabab7', slug: 'pet_bouloute' },
    })
    expect(r).toEqual({ spawn: true, glb_url: mob_url('hy_lamb'), key: 'pet_bouloute' })
  })
})

describe("resolve_pet_companion — ?pet dev override (QA path, mirrors resolve_mount's ?mount=)", () => {
  const with_dev = (fn) => {
    process.env.DEV = '1'
    try {
      return fn()
    } finally {
      delete process.env.DEV
    }
  }

  test('?pet=<slug> forces a spawn regardless of the live equipped state (through the same resolver)', () => {
    const r = with_dev(() =>
      resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon', (slug) =>
        slug === 'pet_timon' ? 'https://cdn.test/mob/hy_timon.glb' : null
      )
    )
    expect(r).toEqual({ spawn: true, glb_url: 'https://cdn.test/mob/hy_timon.glb', key: 'pet_timon' })
  })

  test('?pet=<slug> with no catalog row returns no-spawn instead of a placeholder', () => {
    const r = with_dev(() =>
      resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon', () => null)
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('DEV off: the query is inert and the live (unequipped) state renders nothing', () => {
    const resolve_model = () => {
      throw new Error('resolver must not run — DEV is off and no pet is equipped')
    }
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon', resolve_model)
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })
})
