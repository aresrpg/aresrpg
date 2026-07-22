// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET COMPANION — the pure decision helper (RED-FIRST unit; see the module header for the "never built"
// finding). Before this module existed, `character.pet`/`pet_equipped` reached the roster card and
// stopped — nothing decided spawn/despawn/appearance. The resolver is kept engine-free so this regression
// remains executable in the public checkout where the private character GLB is unavailable (the rig factory
// stays integration-proven, like mount_rig.js — no bun:test file exercises a GLTFLoader).

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { configure_walrus_assets, reset_walrus_assets_for_test } from '@aresrpg/sdk/jobs'

import { set_pet_catalog_for_test } from './data/pet_catalog.js'
import { resolve_pet_companion } from './pet_companion_resolver.js'

const MOB_BASE = 'https://assets.test/v1/blobs/by-quilt-id/mob-test'
const MOB_QUILT = 'mob-test'
const catalog_lookup = (catalog) => (slug) => {
  const glb = catalog[slug]?.glb ?? null
  return glb ? `${MOB_BASE}/${glb}.glb` : null
}

// Reset the shared Walrus resolver (one home — packages/sdk/src/jobs.js), THEN configure only the mob
// quilt this suite's default resolver (get_pet_model_url) reads. configure_walrus_assets only ever
// MERGES, so the old `afterAll({ mob: {} })` could never truly clear the class — it left an empty mob
// entry warmed for later files and never reset the aggregator. reset-then-configure isolates this file
// from earlier ones and leaves no trace for later ones (bun shares the module process-wide).
beforeEach(() => {
  reset_walrus_assets_for_test()
  configure_walrus_assets({ classes: { mob: { quilt: MOB_QUILT } } })
})
afterEach(() => set_pet_catalog_for_test())
afterAll(() => reset_walrus_assets_for_test())

describe('resolve_pet_companion — spawn/despawn + appearance verdict', () => {
  test('catalog-first: a published glb resolves through the mob quilt', () => {
    set_pet_catalog_for_test({
      pet_bouloute: { appearance: 'bouloute', glb: 'hy_bouloute' },
    })
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } },
      ''
    )
    expect(r.spawn).toBe(true)
    expect(r.key).toBe('pet_bouloute')
    expect(r.glb_url?.endsWith(`/v1/blobs/by-quilt-id/${MOB_QUILT}/hy_bouloute.glb`)).toBe(true)
  })

  test('catalog-first: an absent slug returns the no-spawn verdict, so no GLB fetch can start', () => {
    set_pet_catalog_for_test({})
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } },
      ''
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('catalog-first: a row with glb: null returns the no-spawn verdict (pure defensiveness — the published catalog no longer ships this), so no GLB fetch can start', () => {
    set_pet_catalog_for_test({ pet_bouloute: { appearance: 'bouloute', glb: null } })
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', slug: 'pet_bouloute' } },
      ''
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped + a catalogued slug -> spawn with the mob-quilt model URL', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      '',
      catalog_lookup({ pet_bouloute: { appearance: 'bouloute', glb: 'hy_bouloute' } })
    )
    expect(r).toEqual({
      spawn: true,
      glb_url: `${MOB_BASE}/hy_bouloute.glb`,
      key: 'pet_bouloute',
    })
  })

  test('pet_equipped: false -> never consults the catalog, even if a stale `pet` object is present', () => {
    const resolve_model = () => {
      throw new Error('catalog lookup must not run for an unequipped pet')
    }
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: false, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      '',
      resolve_model
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped: true + pet: null (the honest identity-snapshot-gap contract) -> no placeholder spawn', () => {
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: true, pet: null }, '')
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('pet_equipped: true + a slug-less pet shape -> never spawns (no guessed identity)', () => {
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: true, pet: { item_id: '0xa004' } }, '')
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('no pet slot / null / undefined character -> never spawns, never throws', () => {
    expect(resolve_pet_companion({ id: 'c1' }, '')).toEqual({ spawn: false, glb_url: null, key: null })
    expect(resolve_pet_companion(null, '')).toEqual({ spawn: false, glb_url: null, key: null })
    expect(resolve_pet_companion(undefined, '')).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('a switch to a different equipped pet re-keys (the caller diffs glb_url to recreate the rig)', () => {
    const resolve_model = catalog_lookup({
      pet_bouloute: { appearance: 'bouloute', glb: 'hy_bouloute' },
      pet_tokeko: { appearance: 'tokeko', glb: 'hy_tokeko' },
    })
    const bouloute = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa', template_id: '0xb', slug: 'pet_bouloute' } },
      '',
      resolve_model
    )
    const tokeko = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xc', template_id: '0xd', slug: 'pet_tokeko' } },
      '',
      resolve_model
    )
    expect(bouloute.glb_url).not.toBe(tokeko.glb_url)
    expect(tokeko).toEqual({
      spawn: true,
      glb_url: `${MOB_BASE}/hy_tokeko.glb`,
      key: 'pet_tokeko',
    })
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

  test('?pet=<slug> forces a spawn regardless of the live equipped state', () => {
    const resolve_model = catalog_lookup({ pet_timon: { appearance: 'timon', glb: 'hy_timon' } })
    const r = with_dev(() =>
      resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon', resolve_model)
    )
    expect(r).toEqual({ spawn: true, glb_url: `${MOB_BASE}/hy_timon.glb`, key: 'pet_timon' })
  })

  test('?pet=<slug> with no catalog row returns no-spawn instead of probing a cosmetic URL', () => {
    const r = with_dev(() =>
      resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon', catalog_lookup({}))
    )
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })

  test('DEV off: the query is inert and the live (unequipped) state renders nothing', () => {
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon')
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })
})
