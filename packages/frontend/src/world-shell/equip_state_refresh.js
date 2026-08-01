// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_CATEGORY as item_category } from '@aresrpg/sdk/items'
import { mask_pending_items } from '@aresrpg/inventory/consumable_ledger'

import { rpc_get } from '../rpc/client'

const stackable_categories = new Set([item_category.CONSUMABLE, item_category.RESOURCE, item_category.RUNE])

const view_reads = (address, read) => [
  read('/v1/characters', { owner: address }, undefined, true),
  read('/v1/owner-items', { address }, undefined, true),
]

const wait_ms = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const equipped_ids_of = (character) => {
  const ids = new Set()
  for (const row of character?.equipment ?? []) {
    const id = typeof row === 'string' ? row : (row?.item_id ?? row?.id)
    if (id) ids.add(id)
  }
  for (const row of Object.values(character?.worn ?? {})) {
    const id = row?.item_id ?? row?.id
    if (id) ids.add(id)
  }
  // The pet slot is EQUIPMENT_SLOTS' 'pet' entry (Inventory.jsx) but rides its own /v1 identity pair —
  // character.pet/pet_equipped, never a row inside character.equipment (views.js character_pet_projection
  // is a dedicated sibling snapshot, confirmed against the team's own views.test.js fixture: an equipped
  // pet's item id never appears in that character's `equipment` map). Without this, a pet (un)equip's
  // expected id can never be found here, so equip_projection_confirms always fails it.
  if (character?.pet_equipped === true) {
    const pet_id = character?.pet?.item_id ?? character?.pet?.id
    if (pet_id) ids.add(pet_id)
  }
  return ids
}

/** A post-tx projection is confirmed only when character equipment and the loose bag agree on the delta. */
export function equip_projection_confirms(character, item_rows, expected_change) {
  if (!expected_change) return true
  // Equipment identity is event-projected while the signed cache is object-snapshotted. `/v1` deliberately
  // returns null until both checkpoint stamps converge; accepting that mixed row would freeze stale max HP.
  if (character?.equipment_stats == null) return false
  const equipped = new Set(expected_change.equipped_ids ?? [])
  const unequipped = new Set((expected_change.unequipped_ids ?? []).filter((id) => !equipped.has(id)))
  const projected_equipment = equipped_ids_of(character)
  const projected_bag = new Set((item_rows ?? []).map((row) => row?.id).filter(Boolean))
  return (
    [...equipped].every((id) => projected_equipment.has(id) && !projected_bag.has(id)) &&
    [...unequipped].every((id) => !projected_equipment.has(id) && projected_bag.has(id))
  )
}

/** Match load_roster's loose-bag projection without accepting listed marketplace rows. */
export function normalize_equip_items(rows) {
  return rows
    .filter((row) => row?.listed !== true)
    .map((row) => ({ ...row, stackable: stackable_categories.has(row.item_category) }))
}

/**
 * Refresh both equip-owned projections from /v1, apply them atomically, and return only after that write lands.
 * Wave one drains an identical request that may have started before the executed failure; wave two bypasses the
 * LRU and therefore supplies the post-latch success oracle. This reconciles state only and never submits a tx.
 * @param {{address:string, character_id:string,
 *   expected_change?:{equipped_ids:string[],unequipped_ids:string[]}}} target
 * @param {{read?:(path:string, params:any, signal:any, fresh:boolean)=>Promise<any>, get_state?:()=>any,
 *   write?:(payload:any)=>void, map_character?:(row:any)=>any,
 *   mask_items?:(rows:any[], pending?:Record<string,number>)=>any[],
 *   is_current?:()=>boolean, wait?:(ms:number)=>Promise<void>}} [deps]
 */
export async function reconcile_equip_state(
  { address, character_id, expected_change },
  {
    read = rpc_get,
    get_state,
    write,
    map_character,
    mask_items = mask_pending_items,
    is_current = () => true,
    wait = wait_ms,
  } = {}
) {
  if (!address || !character_id) throw new Error('Equipment state refresh needs an owner and character')

  await Promise.allSettled(view_reads(address, read))
  let confirmed_character = null
  let confirmed_items = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [character_view, item_view] = await Promise.all(view_reads(address, read))
    const character_rows = character_view?.characters
    const item_rows = item_view?.items
    if (!Array.isArray(character_rows) || !Array.isArray(item_rows))
      throw new Error('Equipment state refresh returned incomplete projections')
    const selected = character_rows.find((row) => row?.id === character_id)
    if (!selected) throw new Error('Equipment state refresh did not return the selected character')
    if (equip_projection_confirms(selected, item_rows, expected_change)) {
      confirmed_character = selected
      confirmed_items = item_rows
      break
    }
    if (attempt < 3) await wait(800)
  }
  if (!confirmed_character || !confirmed_items)
    throw new Error('Equipment state refresh did not confirm the submitted equipment change')
  if (!is_current()) throw new Error('Equipment state refresh owner changed before reconcile')

  if (!get_state || !write || !map_character) {
    const [{ context }, { rpc_to_card }] = await Promise.all([
      import('../game/core/game.js'),
      import('../roster/boot_roster.js'),
    ])
    get_state ??= () => context.get_state()
    write ??= (payload) => context.dispatch('action/sui_data', payload)
    map_character ??= rpc_to_card
  }

  const current_characters = get_state()?.sui?.characters ?? []
  const mapped_character = map_character(confirmed_character)
  const characters = current_characters.some((row) => row.id === character_id)
    ? current_characters.map((row) => (row.id === character_id ? { ...row, ...mapped_character } : row))
    : [...current_characters, mapped_character]
  // The receipt-proven floor is the reducer's (merge_default re-applies it on this very write); only the
  // in-flight consume mask has to ride along, and it reads the SAME reducer-owned ledger the bag renders.
  const items = mask_items(normalize_equip_items(confirmed_items), get_state()?.sui?.pending_uses)
  if (!is_current()) throw new Error('Equipment state refresh owner changed before store write')
  write({ characters, items })
  return true
}
