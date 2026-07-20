// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  equip_ptb,
  unequip_ptb,
  burn_ptb,
} from '../src/sui/write/items_extract.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

/** Resolve a single built-tx MoveCall argument (Input only — NestedResult has no static object id) to its
 *  underlying object id, or null. Mirrors dungeon.test.js's identical convention. */
function arg_object_id(tx, arg) {
  if (arg?.$kind !== 'Input') return null
  const inp = tx.getData().inputs[arg.Input]
  return (
    inp?.UnresolvedObject?.objectId ??
    inp?.Object?.SharedObject?.objectId ??
    inp?.Object?.ImmOrOwnedObject?.objectId ??
    null
  )
}

// The S-46 merge killed the ExtensionCap — no `extension_cap_id` anywhere (the doors are owner-driven now).
// EQUIP goes through equipment::equip now (the map fold — gear combat-live), so it carries the item's template id.
const equip_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  item_id: id('i0'),
  item_template_id: id('t0'),
}
const unequip_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  item_key_id: id('i0'),
}
const burn_args = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  item_id: id('i0'),
}

describe('items extract builders — refuse loudly when items undeployed', () => {
  test('equip / unequip / burn refuse', () => {
    expect(() => equip_ptb(undeployed_context)(equip_args)).toThrow(
      /not deployed/,
    )
    expect(() => unequip_ptb(undeployed_context)(unequip_args)).toThrow(
      /not deployed/,
    )
    expect(() => burn_ptb(undeployed_context)(burn_args)).toThrow(
      /not deployed/,
    )
  })
})

describe('equip — extract_for_equip then equipment::equip (the map fold: gear stats + weapon_family go combat-live)', () => {
  test('target order + arg shapes + aresrpg package', () => {
    const tx = equip_ptb(deployed_context)(equip_args)
    // equipment::equip borrows the character out of the kiosk INTERNALLY (kiosk.borrow_mut) and calls
    // extract::confirm_equip inside it — so the PTB is a clean 2-call aresrpg composite, no borrow_val dance.
    expect(targets(tx)).toEqual([
      'extract::extract_for_equip',
      'equipment::equip',
    ])
    expect(find_call(tx, 'extract::extract_for_equip').args).toBe(5)
    const equip = find_call(tx, 'equipment::equip')
    expect(equip.args).toBe(7) // kiosk, pkcap, character_id, item, pledge, template, version
    expect(equip.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
  })

  test('refuses without item_template_id — never composes the combat-inert confirm_equip-only path', () => {
    expect(() =>
      equip_ptb(deployed_context)({ ...equip_args, item_template_id: undefined }),
    ).toThrow(/item_template_id/)
  })

  // PET-EQUIP KIOSK LINEAGE (v33): a pet bought via any_personal_kiosk (or minted before this
  // wallet's kiosks converged) can sit in a DIFFERENT personal kiosk than the one holding the character —
  // "This item belongs to a different kiosk" (0x2::kiosk EItemNotFound) was the single hardwired `kiosk_id`
  // feeding BOTH extract_for_equip (needs the ITEM's kiosk) and equipment::equip (needs the CHARACTER's
  // kiosk). Mirrors dungeon.test.js's "keeps key-kiosk and character-kiosk ownership proofs distinct".
  test('sibling kiosk: extract_for_equip targets the ITEM kiosk, equipment::equip keeps the CHARACTER kiosk', () => {
    const item_kiosk_id = id('pet-kiosk')
    const item_kiosk_cap_id = id('pet-cap')
    const tx = equip_ptb(deployed_context)({
      ...equip_args,
      item_kiosk_id,
      item_kiosk_cap_id,
    })
    const [extract, equip] = tx.getData().commands
    expect(arg_object_id(tx, extract.MoveCall.arguments[0])).toBe(item_kiosk_id)
    expect(arg_object_id(tx, extract.MoveCall.arguments[1])).toBe(item_kiosk_cap_id)
    expect(arg_object_id(tx, equip.MoveCall.arguments[0])).toBe(equip_args.kiosk_id)
    expect(arg_object_id(tx, equip.MoveCall.arguments[1])).toBe(
      equip_args.personal_kiosk_cap_id,
    )
  })

  test('omitted item_kiosk_id defaults both legs to the character kiosk (co-located case, unchanged)', () => {
    const tx = equip_ptb(deployed_context)(equip_args)
    const [extract] = tx.getData().commands
    expect(arg_object_id(tx, extract.MoveCall.arguments[0])).toBe(equip_args.kiosk_id)
    expect(arg_object_id(tx, extract.MoveCall.arguments[1])).toBe(
      equip_args.personal_kiosk_cap_id,
    )
  })

  test('refuses item_kiosk_id without its cap — never composes a tx that can only abort on-chain', () => {
    expect(() =>
      equip_ptb(deployed_context)({ ...equip_args, item_kiosk_id: id('pet-kiosk') }),
    ).toThrow(/item_kiosk_cap_id/)
  })
})

describe('unequip — equipment::unequip (un-fold + detach) then re-lock into the same personal kiosk', () => {
  test('target order + arg shapes', () => {
    const tx = unequip_ptb(deployed_context)(unequip_args)
    // equipment::unequip borrows the character INTERNALLY + reverses the map fold; the re-lock needs the RAW
    // owner cap, so only item::lock_in_kiosk is wrapped in the personal-cap borrow/return dance.
    expect(targets(tx)).toEqual([
      'equipment::unequip',
      'personal_kiosk::borrow_val',
      'item::lock_in_kiosk',
      'personal_kiosk::return_val',
    ])
    expect(find_call(tx, 'equipment::unequip').args).toBe(5) // kiosk, pkcap, character_id, item_id, version
    expect(find_call(tx, 'item::lock_in_kiosk').args).toBe(5)
    expect(find_call(tx, 'equipment::unequip').package).toBe(
      IDS.aresrpg.LATEST_PACKAGE_ID,
    )
  })
})

describe('burn — extract_for_burn then burn', () => {
  test('target order + arg shapes', () => {
    const tx = burn_ptb(deployed_context)(burn_args)
    expect(targets(tx)).toEqual(['extract::extract_for_burn', 'extract::burn'])
    expect(find_call(tx, 'extract::extract_for_burn').args).toBe(5)
    expect(find_call(tx, 'extract::burn').args).toBe(3) // the merge dropped the ExtensionCap arg
  })
})

describe('kiosk-rule-linkage — unequip still mixes personal_kiosk::* with an aresrpg call, so it MUST target the aresrpg-bound fork', () => {
  test('unequip resolves personal_kiosk at KIOSK_ROYALTY_RULE_PACKAGE_ID; equip no longer calls personal_kiosk::* at all', () => {
    const unequip_tx = unequip_ptb(deployed_context)(unequip_args)
    expect(find_call(unequip_tx, 'personal_kiosk::borrow_val').package).toBe(
      IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    )
    expect(find_call(unequip_tx, 'personal_kiosk::return_val').package).toBe(
      IDS.aresrpg.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    )

    // equip is a pure aresrpg composite now (extract_for_equip → equipment::equip) — no personal_kiosk PTB
    // command exists to mis-link (the KioskOwnerCap borrow happens inside equipment::equip's own bytecode).
    expect(targets(equip_ptb(deployed_context)(equip_args))).not.toContain(
      'personal_kiosk::borrow_val',
    )
  })
})
