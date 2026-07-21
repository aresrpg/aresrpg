// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET COMPANION — the pure decision helper (RED-FIRST unit; see the module header for the "never built"
// finding). Before this module existed, `character.pet`/`pet_equipped` reached the roster card and
// stopped — nothing decided spawn/despawn/appearance. This proves the decision in isolation, matching
// cosmetic_glb.test.js's resolve_mount/resolve_worn_cosmetics coverage shape (the rig factory itself
// stays integration-proven, like mount_rig.js — no bun:test file exercises a GLTFLoader).

import { describe, expect, test } from 'bun:test'

import '../test_helpers/env_mock.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): pet_companion.js imports @aresrpg/engine3, whose board_entities.js/
// character_controller.js unconditionally import character_avatar.js — a static import of the
// absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js.
const { resolve_pet_companion } = SENSHI_MALE_GLB_AVAILABLE ? await import('./pet_companion.js') : {}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('resolve_pet_companion — spawn/despawn + appearance verdict', () => {
  test('pet_equipped + a slug sibling -> spawn, glb by the SAME cosmetic_glb_url convention worn cosmetics use', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      ''
    )
    expect(r).toEqual({ spawn: true, glb_url: 'https://cdn.test/cosmetics/pet_bouloute.glb', key: 'pet_bouloute' })
  })

  test('pet_equipped: false -> never spawns, even if a stale `pet` object is present', () => {
    const r = resolve_pet_companion(
      { id: 'c1', pet_equipped: false, pet: { item_id: '0xa004', template_id: '0x7a05', slug: 'pet_bouloute' } },
      ''
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
    const bouloute = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xa', template_id: '0xb', slug: 'pet_bouloute' } },
      ''
    )
    const tokeko = resolve_pet_companion(
      { id: 'c1', pet_equipped: true, pet: { item_id: '0xc', template_id: '0xd', slug: 'pet_tokeko' } },
      ''
    )
    expect(bouloute.glb_url).not.toBe(tokeko.glb_url)
    expect(tokeko).toEqual({ spawn: true, glb_url: 'https://cdn.test/cosmetics/pet_tokeko.glb', key: 'pet_tokeko' })
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  "resolve_pet_companion — ?pet dev override (QA path, mirrors resolve_mount's ?mount=)",
  () => {
  const with_dev = (fn) => {
    process.env.DEV = '1'
    try {
      return fn()
    } finally {
      delete process.env.DEV
    }
  }

  test('?pet=<slug> forces a spawn regardless of the live equipped state', () => {
    const r = with_dev(() => resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon'))
    expect(r).toEqual({ spawn: true, glb_url: 'https://cdn.test/cosmetics/pet_timon.glb', key: 'pet_timon' })
  })

  test('DEV off: the query is inert and the live (unequipped) state renders nothing', () => {
    const r = resolve_pet_companion({ id: 'c1', pet_equipped: false, pet: null }, '?pet=pet_timon')
    expect(r).toEqual({ spawn: false, glb_url: null, key: null })
  })
})
