import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'

import { borrow_personal_kiosk_cap } from './borrow_personal_kiosk_cap.js'

// ITEMS EXTRACT SEAM PTB BUILDERS for the merged `aresrpg` package — the two royalty-safe ways a kiosk-LOCKED
// item leaves the market for a NON-trade reason: to be WORN (equip/unequip) or DESTROYED (burn). The S-46 merge
// KILLED the ExtensionCap: the doors are plain owner-driven now (the pledge hot-potatoes + the personal-cap
// borrow are the whole authority story) — no server cap, no `extension_cap_id`. S-51b: the wrapped empty
// `ItemExtractPolicy` resolves STATICALLY from the deployment home (EXTRACT_POLICY); Version/ItemPolicy ride the
// shared-version cache, and the kiosk/pkcap/item params ride the ref-or-id seam (`as_object_arg`).
//
// EQUIP GOES THROUGH `equipment`, NOT bare `extract`. `extract::confirm_equip` ALONE only attaches the item DF —
// it never writes the `EquipmentMap` (slot bookkeeping + gear-stat fold + weapon_family/tool_job), so gear folded
// to allocated-only and the fight's +10% affinity could never fire. The map is written ONLY by
// `aresrpg::equipment::equip`, which enforces the slot rules, folds the stats, records the weapon family/tool
// job, then calls `extract::confirm_equip` INTERNALLY (the custody DF attach + the `ItemEquipped` event fire
// exactly as before — the /v1 projection is event-sourced on those, so it is not stranded). So equip_ptb composes
// `extract_for_equip` → `equipment::equip` (which needs the item's `&ItemTemplate` for the required-level gate +
// stat-fold source). Mirror on the way out: `equipment::unequip` un-folds the map AND (via `extract::unequip`)
// removes the DF + emits `ItemUnequipped`, handing back the item + a `LockPledge` for the re-lock.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/{extract,equipment,item}.move):
//   public fun extract::extract_for_equip(kiosk, personal_cap: &PersonalKioskCap, item_id: ID, policy: &ItemExtractPolicy, version, ctx): (Item, EquipPledge)
//   public fun equipment::equip(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, item: Item, pledge: EquipPledge, template: &ItemTemplate, version) // borrows the character via kiosk.borrow_mut INTERNALLY; calls extract::confirm_equip inside
//   public fun equipment::unequip(kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, item_id: ID, version): (Item, LockPledge) // borrows the character INTERNALLY; calls extract::unequip inside
//   public fun extract::extract_for_burn(kiosk, personal_cap, item_id, policy, version, ctx): (Item, BurnPledge)
//   public fun extract::burn(pledge: BurnPledge, item: Item, version): (ID, u64)
//   public fun item::lock_in_kiosk(pledge: LockPledge, item, &mut Kiosk, &KioskOwnerCap, &TransferPolicy<Item>)

/**
 * EQUIP: pull the locked `item_id` out of the kiosk and PLACE it into its character slot — folding the gear stats
 * + recording the weapon family/tool job so gear is combat-LIVE — in ONE tx. Sequence: `extract::extract_for_equip`
 * (pkcap direct) → `equipment::equip`, which enforces the slot rules, folds the stats, and discharges the
 * `EquipPledge` via `extract::confirm_equip` INTERNALLY (custody DF attach + `ItemEquipped` event). `equipment::equip`
 * borrows the character out of the kiosk itself (`kiosk.borrow_mut`), so there is NO borrow_val/return_val dance here.
 *
 * SIBLING-KIOSK LAW (S-57, mirrors dungeon.js's `activate_ptb` key leg): `extract_for_equip`'s kiosk arg only needs
 * to HOLD THE ITEM; `equipment::equip`'s kiosk arg only needs to HOLD THE CHARACTER — two independent `&mut Kiosk`
 * refs at the Move level, never required to be the same object (the earlier single-`kiosk` composition here
 * silently assumed co-location and aborted `0x2::kiosk::EItemNotFound` the moment a multi-kiosk wallet's pet/item
 * sat in a sibling kiosk — bought via `any_personal_kiosk`, or minted before this wallet's kiosks converged onto
 * one). `item_kiosk_id`/`item_kiosk_cap_id` are OPTIONAL and default to the character's own kiosk/cap — the
 * common co-located case is byte-for-byte unchanged. Passing `item_kiosk_id` WITHOUT its cap refuses loudly
 * (never compose a tx with the wrong owner cap against a sibling kiosk — that can only abort on-chain); the
 * caller resolves the owned cap for that kiosk FIRST (`cap_for_kiosk`) and refuses the equip when none exists.
 *
 * `item_template_id` is REQUIRED — `equipment::equip` reads the item's required-level off its `&ItemTemplate` (the
 * single home of that fact) and uses it as the stat-fold source. Resolve it from the item's `item_type` slug (the
 * frontend has `get_template_by_item_type_map()` → `t.id`; the bots/tests pass the mint template id directly).
 * Refuses loudly when missing — never silently composes the combat-inert `confirm_equip`-only legacy path.
 * @param {import("../../../types.js").Context} context
 */
export function equip_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    item_id,
    item_template_id,
    item_kiosk_id,
    item_kiosk_cap_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    if (!item_template_id)
      throw new Error(
        '[items_extract] equip_ptb requires item_template_id (the equipped item &ItemTemplate object id). ' +
          'equipment::equip reads the required-level + folds the gear stats off the template; without it the ' +
          'EquipmentMap is never written and gear stays combat-inert. Resolve it from the item_type slug ' +
          '(frontend: get_template_by_item_type_map -> t.id; bots: the mint template id) and pass it. ' +
          'Refusing to compose the dead confirm_equip-only path.',
      )
    if (item_kiosk_id && !item_kiosk_cap_id)
      throw new Error(
        "[items_extract] equip_ptb got item_kiosk_id without item_kiosk_cap_id — the character's own cap does " +
          'not authorize a sibling kiosk. Resolve the OWNED cap for that kiosk first (cap_for_kiosk) and refuse ' +
          'the equip when none exists; never compose a tx that can only abort on-chain.',
      )
    const character_kiosk = as_object_arg(tx, kiosk_id)
    const character_pkcap = as_object_arg(tx, personal_kiosk_cap_id)
    // THE ITEM's own kiosk — defaults to the character's (the pre-fix, still-common co-located case).
    const item_kiosk = item_kiosk_id ? as_object_arg(tx, item_kiosk_id) : character_kiosk
    const item_pkcap = item_kiosk_id ? as_object_arg(tx, item_kiosk_cap_id) : character_pkcap
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)

    // 1. extract the locked item OUT of ITS OWN kiosk (its own internal cap borrow is scoped to this call).
    const [item, equip_pledge] = tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::extract_for_equip`,
      arguments: [
        item_kiosk,
        item_pkcap,
        tx.pure.id(item_id),
        shared_object_arg(tx, network, 'EXTRACT_POLICY', false, a.EXTRACT_POLICY), // policy: &ItemExtractPolicy (S-51b static)
        version,
      ],
    })

    // 2. PLACE it onto the CHARACTER's kiosk: equipment::equip enforces the slot rules, FOLDS the gear stats +
    //    records weapon_family/tool_job (the combat-live bookkeeping), then discharges the pledge via
    //    extract::confirm_equip INTERNALLY (custody DF attach + ItemEquipped event). It borrows the character
    //    mutably out of the CHARACTER's kiosk — independent of whichever kiosk the item was just pulled from.
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::equipment::equip`,
      arguments: [
        character_kiosk, // kiosk: &mut Kiosk (the CHARACTER's kiosk)
        character_pkcap, // pkcap: &PersonalKioskCap (borrows the KioskOwnerCap internally)
        tx.pure.id(character_id), // character_id: ID
        item, // item: Item (from extract_for_equip, whichever kiosk it came from)
        equip_pledge, // pledge: EquipPledge (discharged inside via confirm_equip)
        as_object_arg(tx, item_template_id), // template: &ItemTemplate (required-level gate + stat-fold source)
        version, // version: &Version
      ],
    })
    return tx
  }
}

/**
 * UNEQUIP: DETACH the equipped item (stored under `item_key_id` = its own id) from the character — UN-folding the
 * gear stats + freeing the slot in the `EquipmentMap` — and RE-LOCK it into the same personal kiosk. Sequence:
 * `equipment::unequip` (borrows the character out of the kiosk INTERNALLY, reverses the slot bookkeeping + fold,
 * and via `extract::unequip` removes the DF + emits `ItemUnequipped`, returning the item + a `LockPledge`) →
 * `item::lock_in_kiosk` (re-lock via the raw owner cap — the constitution re-imposed the moment it leaves).
 *
 * The re-lock needs the RAW `&KioskOwnerCap`, so the personal-cap borrow/return dance wraps JUST that step; the
 * detach itself takes `&PersonalKioskCap` directly. No `item_template_id` needed here — `equipment::unequip` reads
 * the item's category + template id off the item itself.
 * @param {import("../../../types.js").Context} context
 */
export function unequip_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    item_key_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const kiosk = as_object_arg(tx, kiosk_id)
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)

    // 1. DETACH + un-fold: equipment::unequip borrows the character out of the kiosk internally, reverses the slot
    //    bookkeeping + the gear fold, and (via extract::unequip) removes the item DF + emits ItemUnequipped.
    const [item, lock_pledge] = tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::equipment::unequip`,
      arguments: [
        kiosk, // kiosk: &mut Kiosk
        as_object_arg(tx, personal_kiosk_cap_id), // pkcap: &PersonalKioskCap (borrows the KioskOwnerCap internally)
        tx.pure.id(character_id), // character_id: ID
        tx.pure.id(item_key_id), // item_id: ID (the equipment DF key = the item's own id)
        version, // version: &Version
      ],
    })

    // 2. RE-LOCK the detached item into the same personal kiosk. item::lock_in_kiosk needs the RAW &KioskOwnerCap,
    //    so the borrow/return dance wraps only this step (LockPledge type-forces the re-lock in the same PTB).
    borrow_personal_kiosk_cap(context)({
      personal_kiosk_cap_id,
      tx,
      handler: kiosk_cap => {
        tx.moveCall({
          target: `${a.LATEST_PACKAGE_ID}::item::lock_in_kiosk`,
          arguments: [
            lock_pledge, // pledge: LockPledge (forces the re-lock)
            item, // item: Item
            kiosk, // &mut Kiosk
            kiosk_cap, // &KioskOwnerCap
            shared_object_arg(tx, network, 'ITEM_POLICY', false, a.ITEM_POLICY), // &TransferPolicy<Item> (S-51b static)
          ],
        })
      },
    })
    return tx
  }
}

/**
 * BURN: pull the locked `item_id` out and DESTROY it (the item ceases to exist ⇒ no royalty evasion). Sequence:
 * `extract_for_burn` (pkcap direct) → `burn`. The `(template, amount)` return is dropped here — callers that need
 * the ledger credit compose `burn` themselves off this same seam.
 * @param {import("../../../types.js").Context} context
 */
export function burn_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    item_id,
    tx = new Transaction(),
  }) => {
    const a = aresrpg_deployment(network, context.ids?.aresrpg)
    const version = shared_object_arg(tx, network, 'VERSION', false, a.VERSION)
    const [item, burn_pledge] = tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::extract_for_burn`,
      arguments: [
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(item_id),
        shared_object_arg(tx, network, 'EXTRACT_POLICY', false, a.EXTRACT_POLICY), // policy: &ItemExtractPolicy (S-51b static)
        version,
      ],
    })
    tx.moveCall({
      target: `${a.LATEST_PACKAGE_ID}::extract::burn`,
      arguments: [
        burn_pledge, // pledge: BurnPledge
        item, // item: Item
        version, // version: &Version
      ],
    })
    return tx
  }
}
