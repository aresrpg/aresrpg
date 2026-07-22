// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure settle-receipt → inventory INPUT adapter. The atomic mint+burn receipt already proves every created
// Item through item::ItemMinted; turn those facts into bag rows and let the ONE inventory reducer own state.
// No reads, dispatches, callbacks, or store writes live here.

const STACKABLE_CATEGORIES = new Set(['consumable', 'resource', 'rune'])
const chain_category = (category) => {
  const upper = String(category ?? '').toUpperCase()
  return upper === 'FISHINGROD' ? 'fishingRod' : upper.toLowerCase()
}

/**
 * Project one successful mint_all_and_burn outcome into the typed `action/sui_data` reducer input. ItemMinted is
 * exact identity/quantity truth; the already-cached template catalog enriches presentation only. A template miss
 * keeps the real item id/type and honest empty metadata until an authoritative snapshot replaces the floor row.
 * @param {{ receipt?: { events?: any[] }, kiosk_id?: string|null, kiosk_cap_id?: string|null } | null} settlement
 * @param {Map<string, any>} template_by_id
 * @returns {{ kind: 'receipt_patch', op: 'settled_loot', rows: any[] }}
 */
export function settled_loot_input(settlement, template_by_id = new Map()) {
  const rows = (settlement?.receipt?.events ?? []).flatMap((event) => {
    if (!String(event?.type ?? '').endsWith('::item::ItemMinted')) return []
    const minted = event?.parsedJson ?? {}
    const id = String(minted.item ?? '')
    if (!id) return []
    const template_id = String(minted.template ?? '')
    const template = template_by_id.get(template_id) ?? null
    const item_category = chain_category(template?.category)
    const parsed_amount = Number(minted.amount ?? 1)
    return [
      {
        id,
        template_id: template_id || null,
        name: String(template?.name ?? ''),
        item_category,
        item_set: '',
        item_type: String(minted.item_type ?? template?.item_type ?? ''),
        level: 0,
        amount: Number.isFinite(parsed_amount) && parsed_amount > 0 ? parsed_amount : 1,
        kiosk_id: settlement?.kiosk_id ?? null,
        kiosk_cap_id: settlement?.kiosk_cap_id ?? null,
        listed: false,
        stackable: STACKABLE_CATEGORIES.has(item_category),
      },
    ]
  })
  return { kind: 'receipt_patch', op: 'settled_loot', rows }
}
