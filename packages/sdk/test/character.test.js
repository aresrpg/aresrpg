import { describe, test, expect } from 'bun:test'

import { free_character_claim_field_id } from '../src/character.js'

// Historical testnet cryptographic vector. These fixed inputs verify the derived-object bytes; they are test
// fixtures, not deployment pins consumed by SDK runtime code.
const ARES_ROOT =
  '0x29c9ec73807784ae1ef84c197a8c432f18074fee475c369b672b6b253a3bfb40'
const FREE_KEY_PACKAGE =
  '0x71fd9656215a6a19f390a6bbde51359003ebef4a0b92097c956fb3bdbf1e2844'

describe('free_character_claim_field_id (on-chain free-claim marker derivation)', () => {
  // Deterministic blake2b derivation that MUST stay byte-identical to the chain's
  // `derived_object::exists(AresRoot, FreeCharacterKey(address))`. The expected ids were captured against the
  // live testnet (the object id `sui_getObject` resolves for that account's claim marker) — a drift in the
  // derivation (wrong type-tag package, wrong bcs, count vs claim) breaks this guard, the C2 no-trap
  // invariant's last line of defense before the on-chain abort.

  // A real account that HAS claimed its free character on testnet: this marker EXISTS on-chain right now,
  // i.e. the derivation resolves to a live object (the positive case the full escape e2e also exercises).
  test('derives the on-chain claim marker for a claimed account', () => {
    expect(
      free_character_claim_field_id({
        ares_root: ARES_ROOT,
        package_id: FREE_KEY_PACKAGE,
        owner:
          '0x82e1a5c7d1431d0174f3660569421fe0acb38d40a4734f48bb7c798dd260f8ba',
      }),
    ).toBe('0x952224b7e8035d51e7dc595bc9a4f8dae59628843014c4e02ca03aef36c94958')
  })

  // Owner-specific: two different addresses derive two different (stable) markers.
  test('is owner-specific', () => {
    const a = free_character_claim_field_id({
      ares_root: ARES_ROOT,
      package_id: FREE_KEY_PACKAGE,
      owner:
        '0xb4951afe3682d3e9425671f1772e3676bc6ff361ac00896ea131cf52765cd177',
    })
    const b = free_character_claim_field_id({
      ares_root: ARES_ROOT,
      package_id: FREE_KEY_PACKAGE,
      owner:
        '0xa066756b957bad2b2b224908357da64f77d04122ddebf9e11d8538258ff8d2d6',
    })
    expect(a).toBe(
      '0x8913bfbbe45166627a6660f8ac46797865116ba7960648e4838b408c343342b7',
    )
    expect(b).toBe(
      '0x5324e14af751bf69dfa08afc92447878becb970a08de68d88cbec1370214c375',
    )
    expect(a).not.toBe(b)
  })
})
