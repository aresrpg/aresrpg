// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const default_character_counts = Object.freeze([2, 2, 1, 1])

export function character_fixture_plan(wallet_count) {
  if (!Number.isInteger(wallet_count) || wallet_count < 1)
    throw new Error(`wallet_count must be a positive integer; got ${wallet_count}`)
  return Array.from({ length: wallet_count }, (_, wallet_index) => ({
    wallet_index,
    count: default_character_counts[wallet_index] ?? 1,
  }))
}

export function validate_character_fixture(rows) {
  if (!Array.isArray(rows)) throw new Error('character fixture rows must be an array')
  const characters = new Set()
  const kiosks = new Set()
  const caps = new Set()
  const slots = new Set()

  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row?.wallet_index) || row.wallet_index < 0)
      throw new Error(`character fixture row ${index} has an invalid wallet_index`)
    if (!Number.isInteger(row.slot) || row.slot < 0)
      throw new Error(`character fixture row ${index} has an invalid slot`)
    for (const field of ['character_id', 'kiosk_id', 'personal_kiosk_cap_id'])
      if (!row[field] || typeof row[field] !== 'string')
        throw new Error(`character fixture row ${index} needs ${field}`)

    const slot = `${row.wallet_index}:${row.slot}`
    if (slots.has(slot)) throw new Error(`duplicate character fixture slot ${slot}`)
    if (characters.has(row.character_id)) throw new Error(`duplicate character_id ${row.character_id}`)
    if (kiosks.has(row.kiosk_id)) throw new Error(`duplicate kiosk_id ${row.kiosk_id}`)
    if (caps.has(row.personal_kiosk_cap_id))
      throw new Error(`duplicate personal_kiosk_cap_id ${row.personal_kiosk_cap_id}`)
    slots.add(slot)
    characters.add(row.character_id)
    kiosks.add(row.kiosk_id)
    caps.add(row.personal_kiosk_cap_id)
  }
  return rows
}
