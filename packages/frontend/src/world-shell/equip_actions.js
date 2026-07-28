// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board #7 — REAL on-chain equip/unequip via the merged package's EXTRACT seam (permissionless, structural
// correctness via the player's PersonalKioskCap): equip = `extract::extract_for_equip` → `extract::confirm_equip`
// (the EquipPledge hot potato discharges in-tx), unequip = `extract::unequip` → `item::lock_in_kiosk` (the
// LockPledge forces the re-lock — kiosk-lock constitution). The SDK composites live in sui/write/items_extract.js
// (factory keys `equip_ptb`/`unequip_ptb`); they replaced the S-51b-deleted legacy `character_inventory`
// equip_item/unequip_item builders. The equipment SLOT is on-chain derived from the item's own category — no
// slot arg crosses the wire. Mirrors consumable_actions.js: same get_sdk() instance, same personal-kiosk
// resolution, same run_tx path. NO fake — real txs the player pays for.
//
// Inventory.jsx stages MULTIPLE slot changes before committing (drag-to-slot across the paper-doll, then one
// "Accept"). No moveCall takes Random, so they chain freely into ONE Transaction/PTB — the player signs
// once for the whole staged batch, same UX as the old @server sui_equip_items batch call.

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import i18n from '../i18n'
import { note_equip } from '../game/screens/hud/world/quest_ladder_store.js' // ONBOARDING quest-ladder EQUIP seam

import { resolve_equip_templates } from './equip_version_gate.js'
import { run_tx } from './tx'
// S-57 — THE ONE kiosk-resolution home (derive-from-character; never a first-cap scan). See kiosk_resolve.js.
import { kiosk_for_character, cap_for_kiosk } from './kiosk_resolve.js'

/** Honest refusal copy for unresolvable rows — SLUGS only, never object ids (an 0x… id would trip the
 *  decoder's JARGON gate and degrade this to the generic line). Mirrored in equip_actions.test.js. */
const refusal_copy = (/** @type {{item_type?: string}[]} */ unresolved) =>
  `Couldn't equip ${unresolved.map((r) => r.item_type || 'unknown item').join(', ')} — its item template wasn't found on-chain. Unstage it and try again.`

/**
 * Commit a staged equip/unequip batch for one character as a SINGLE signed PTB. Returns
 * `{ result, timing }` (run_tx) so the caller reconciles the bag off the tx result + reads latency.
 * @param {{ character_id: string, to_equip: {item_id: string, slot: string, item_type: string, item_template_id?: string|null, kiosk_id?: string|null, kiosk_cap_id?: string|null}[], to_unequip: {item_id: string, slot: string}[] }} args
 */
export async function equip_items({ character_id, to_equip, to_unequip }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle) throw new Error('That character is not in your kiosk')

  // equipment::equip compares the Item's stamped template id with this &ItemTemplate id exactly. Inventory
  // threads the canonical id from its Accept-time /v1 owner-items preflight; never re-resolve through non-unique
  // item_type (all Lorito variants use `cloak`). A retired template is refused by the CHAIN at simulate (#1467),
  // never pre-refused here against a build-time id set the deployed bundle froze.
  const equips = to_equip ?? []
  const { resolved, unresolved } = resolve_equip_templates(equips)
  // HONEST refusal BEFORE any tx is built (zero gas): the batch is ONE atomic PTB, so an unresolvable item
  // refuses the accept NAMING that item — the decoder passes this human line through untouched, and the
  // caller's catch rolls back the optimistic stage. Never a raw throw, never a silent skip.
  if (unresolved.length) throw new Error(refusal_copy(unresolved))

  // PET-EQUIP KIOSK LINEAGE (S-57 sibling-kiosk law, mirrors dungeon_actions.js activate_run's key leg): a
  // pet/item can sit in a DIFFERENT personal kiosk than the one currently holding the character (bought via
  // any_personal_kiosk, or minted before this wallet's kiosks converged onto one) — the /v1 owner-items row
  // Inventory.jsx threads (`kiosk_id`/`kiosk_cap_id`) NAMES it. Resolve each item's OWN cap only when its row
  // names a kiosk other than the character's (the common co-located case takes zero extra reads); no owned
  // cap for that kiosk is a genuine custody question, so it refuses HONESTLY here — before any tx is built —
  // never composes a PTB that can only abort on-chain with "This item belongs to a different kiosk."
  const with_item_kiosk = await Promise.all(
    resolved.map(async (row) => {
      if (!row.kiosk_id || row.kiosk_id === handle.kiosk_id) return row
      const item_kiosk_cap_id = row.kiosk_cap_id || (await cap_for_kiosk(sdk, address, row.kiosk_id))
      if (!item_kiosk_cap_id) throw new Error(i18n.t('errors.item_wrong_kiosk'))
      return { ...row, item_kiosk_id: row.kiosk_id, item_kiosk_cap_id }
    })
  )

  let tx
  // unequip FIRST — frees the slot on-chain before an equip that reuses it (e.g. a straight swap staged
  // as [unequip old, equip new] on the same slot in one accept). The staged `slot` is UI-only state — the
  // chain derives the slot from the item's category, so only the item id crosses the wire.
  for (const { item_id } of to_unequip ?? [])
    tx = sdk.unequip_ptb({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      character_id,
      item_key_id: item_id, // the equipment DF key IS the item's own id (extract.move `unequip(key: ID)`)
      tx,
    })
  for (const { item_id, item_template_id, item_kiosk_id, item_kiosk_cap_id } of with_item_kiosk)
    tx = sdk.equip_ptb({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      character_id,
      item_id,
      item_template_id, // &ItemTemplate — equipment::equip's level gate + stat-fold source (resolved above)
      item_kiosk_id, // undefined ⇒ equip_ptb defaults to the character's own kiosk (co-located case)
      item_kiosk_cap_id,
      tx,
    })
  if (!tx) return null // nothing staged
  const outcome = await run_tx('equip', tx)
  // ONBOARDING: an equip tx landed → advance the quest ladder's EQUIP step (no-op once past it). Guarded so
  // a tutorial hiccup can never break the equip flow.
  try {
    note_equip()
  } catch {
    /* quest ladder is best-effort */
  }
  return outcome
}
