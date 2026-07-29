// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure Character-mint receipt → roster INPUT adapter. The settled receipt proves the new object identity;
// the submitted draft supplies its presentation until the authoritative roster snapshot catches up.

import { normalize_character } from '../chain/read_character.js'

export type character_mint_draft = Readonly<{
  name: string
  classe: string
  male: boolean
  color_1: number
  color_2: number
  color_3: number
}>

export type character_mint_projection = Readonly<{
  character: any
  kiosk_id: string | null
  personal_kiosk_cap_id: string | null
  roster_input: Readonly<{
    kind: 'receipt_patch'
    op: 'mint_character'
    row: any
  }>
}>

const created_changes = (receipt: any): any[] =>
  (receipt?.objectChanges ?? []).filter((change: any) => change?.type === 'created')

/** A mint continuation may only mutate the roster session that submitted it. */
export const mint_session_matches = (expected_address: string, current_address: string | null): boolean =>
  expected_address === current_address

/**
 * Project a successful Character mint into the ONE roster reducer input. Returns null when the receipt does not
 * prove a created Character; callers then use their existing read-back fallback without fabricating identity.
 */
export function project_character_mint(receipt: any, draft: character_mint_draft): character_mint_projection | null {
  const created = created_changes(receipt)
  const character_change = created.find((change) => String(change?.objectType ?? '').endsWith('::character::Character'))
  if (!character_change?.objectId) return null

  const kiosk_change = created.find((change) => String(change?.objectType ?? '') === '0x2::kiosk::Kiosk')
  const cap_change = created.find((change) => String(change?.objectType ?? '').includes('PersonalKioskCap'))
  const character = normalize_character(
    {
      name: draft.name,
      classe: draft.classe,
      sex: draft.male ? 'male' : 'female',
      color_1: draft.color_1,
      color_2: draft.color_2,
      color_3: draft.color_3,
      experience: 0,
      health: 100,
    },
    String(character_change.objectId),
    String(character_change.objectType)
  )
  const kiosk_id = kiosk_change?.objectId ? String(kiosk_change.objectId) : null
  const personal_kiosk_cap_id = cap_change?.objectId ? String(cap_change.objectId) : null
  const receipt_character = {
    ...character,
    kiosk_id,
    personal_kiosk_cap_id,
  }

  return {
    character: receipt_character,
    kiosk_id,
    personal_kiosk_cap_id,
    roster_input: { kind: 'receipt_patch', op: 'mint_character', row: receipt_character },
  }
}
