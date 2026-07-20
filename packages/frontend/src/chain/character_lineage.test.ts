// Proves the kiosk CHARACTER filter derives from the CURRENT deployment (audit row 12) — it ACCEPTS a character
// of the live lineage (and would follow a fresh-publish re-stamp automatically) and REJECTS the retired demo
// lineage that used to be the ONLY accepted id. A pure leaf test — no store/game imports, no module mocks.
import { describe, expect, test } from 'bun:test'

import { is_aresrpg_character, ARESRPG_PACKAGE_ID, character_type_id } from './character_lineage'

// The retired demo package that USED to be hardcoded as the sole accepted lineage (the bug).
const RETIRED_DEMO_LINEAGE = '0xaa8ea8070a8f96f7d0eea00d97a5d2751b06615d7cbe5a2def9e16fce9376f31'

describe('is_aresrpg_character — filter follows the SDK deployment, never a hardcoded lineage', () => {
  test('ACCEPTS a Character of the current deployment lineage', () => {
    // Testnet is stamped, so the derived id must be non-empty (guards against a false-green on an empty filter).
    expect(ARESRPG_PACKAGE_ID).not.toBe('')
    expect(is_aresrpg_character(character_type_id(ARESRPG_PACKAGE_ID))).toBe(true)
    // a non-0x-padded chain-returned type still compares equal (both sides normalised)
    expect(is_aresrpg_character(`${ARESRPG_PACKAGE_ID}::character::Character`)).toBe(true)
  })

  test('REJECTS the retired DEMO lineage (the exact bug this fixes)', () => {
    expect(is_aresrpg_character(`${RETIRED_DEMO_LINEAGE}::character::Character`)).toBe(false)
  })

  test('REJECTS a non-Character type / bare struct suffix (package-scoped match)', () => {
    expect(is_aresrpg_character(`${ARESRPG_PACKAGE_ID}::item::Item`)).toBe(false)
    expect(is_aresrpg_character('0x2::coin::Coin')).toBe(false)
  })

  test('never throws on a malformed or empty type', () => {
    expect(is_aresrpg_character('not-a-type')).toBe(false)
    expect(is_aresrpg_character('')).toBe(false)
  })
})
