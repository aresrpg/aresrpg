// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import { delete_character_ptb } from '../src/sui/write/character_delete.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

// BACKLOG 18 — the character DELETE builder (character_extract::delete_character): ONE moveCall that
// zero-price-extracts the kiosk-locked character through the sealed CharacterExtractPolicy, asserts the
// guard set ON-CHAIN (unequipped / no unopened fight / no dungeon lock) and destroys it. No pledge, no
// borrow_val dance — the raw Character never crosses a public boundary.
const delete_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
}

// CHARACTER_EXTRACT_POLICY ships with the NEXT upgrade ceremony, so the baked testnet SHARED_VERSIONS map
// has no version pin for it yet. A LOCALNET-network context resolves shared objects through the unresolved
// `tx.object(id)` fallback (exactly a fresh publish's state) — the composer builds; post-ceremony testnet
// resolves the static ref with zero code change.
const prestamp_context = { ...deployed_context, network: 'localnet' }

describe('character delete builder — refuse loudly when undeployed', () => {
  test('refuses on an empty deployment', () => {
    expect(() => delete_character_ptb(undeployed_context)(delete_args)).toThrow(
      /not deployed/,
    )
  })

  test('refuses when CHARACTER_EXTRACT_POLICY itself is unstamped (pre-ceremony network)', () => {
    const ids = {
      aresrpg: { ...IDS.aresrpg, CHARACTER_EXTRACT_POLICY: '' },
    }
    expect(() =>
      delete_character_ptb({ ...prestamp_context, ids })(delete_args),
    ).toThrow(/CHARACTER_EXTRACT_POLICY/)
  })
})

describe('delete — ONE character_extract::delete_character call (guards live on-chain)', () => {
  test('target + arg shape + aresrpg package', () => {
    const tx = delete_character_ptb(prestamp_context)(delete_args)
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'character_extract::delete_character',
    ])
    const call = find_call(tx, 'character_extract::delete_character')
    expect(call.args).toBe(5) // kiosk, pkcap, character_id, policy, version
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.types).toEqual([]) // no type args — the door is Character-concrete
  })

  test('chainable — composes onto a caller-supplied Transaction', () => {
    const first = delete_character_ptb(prestamp_context)(delete_args)
    const tx = delete_character_ptb(prestamp_context)({
      ...delete_args,
      character_id: id('ca1'),
      tx: first,
    })
    // ONE header — it rides the FIRST tx (fresh-constructed); the second call chains onto the caller-supplied
    // `tx`, so its own header default never fires (never duplicated mid-batch).
    expect(targets(tx)).toEqual([
      'header::aresrpg',
      'character_extract::delete_character',
      'character_extract::delete_character',
    ])
  })
})
