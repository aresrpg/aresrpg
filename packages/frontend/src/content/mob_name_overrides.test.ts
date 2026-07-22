// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rank-zero content fix: the world-3 draugr_retarded MobTemplate's shipped chain name is unacceptable and
// must never reach a player, interim until the identity rename door (#521). Pins the override + its reverse
// (the model/icon catalog lookup must still resolve the REAL asset off the overridden display string).
import { describe, expect, test } from 'bun:test'

import { catalog_name_of, display_mob_name } from './mob_name_overrides'

describe('display_mob_name', () => {
  test('the shipped draugr_retarded chain name renders as the interim display name', () => {
    expect(display_mob_name('Retarded Draugr')).toBe('Shambling Draugr')
  })

  test('every other chain/authored name passes through unchanged', () => {
    expect(display_mob_name('Sewer Rat')).toBe('Sewer Rat')
    expect(display_mob_name('Aberrant Hulk')).toBe('Aberrant Hulk')
  })

  test('null/undefined/empty degrade to an honest empty string, never a crash', () => {
    expect(display_mob_name(null)).toBe('')
    expect(display_mob_name(undefined)).toBe('')
    expect(display_mob_name('')).toBe('')
  })
})

describe('catalog_name_of (the reverse half — protects game/data/mobs.js model/icon resolution)', () => {
  test('undoes the override so the reference-corpus catalog still resolves off the raw seed name', () => {
    expect(catalog_name_of('Shambling Draugr')).toBe('Retarded Draugr')
  })

  test('the raw chain name is already a catalog key — passes through unchanged, never double-mapped', () => {
    expect(catalog_name_of('Retarded Draugr')).toBe('Retarded Draugr')
  })

  test('every other name passes through unchanged', () => {
    expect(catalog_name_of('Sewer Rat')).toBe('Sewer Rat')
  })

  test('null/undefined/empty degrade to an honest empty string, never a crash', () => {
    expect(catalog_name_of(null)).toBe('')
    expect(catalog_name_of(undefined)).toBe('')
  })

  test('round-trips: catalog_name_of(display_mob_name(raw)) recovers the raw chain name', () => {
    const raw = 'Retarded Draugr'
    expect(catalog_name_of(display_mob_name(raw))).toBe(raw)
  })
})
