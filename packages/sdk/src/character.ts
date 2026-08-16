// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character builder — creation + progression through the app's ONE chain door. A receipt
// tells the client everything about its OWN action; the server only streams what the client
// cannot know. The new row is the door's inputs plus Move's fixed starting values — twinned
// with character.move: a change there lands here in the same commit.

import type { CharacteristicName } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import type { KioskOwnerCap } from '@mysten/kiosk'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, deriveObjectID } from '@mysten/sui/utils'

import { SDK } from './client.ts'
import { receipt_digest, receipt_event } from './cache.ts'

export type { KioskOwnerCap } from '@mysten/kiosk'

type GameSdk = ReturnType<typeof SDK>

/** character.move `PRICE` — 1 SUI, exact, no change given. */
export const CHARACTER_PRICE_MIST = 1_000_000_000n

/** Move's character-name law. The normalized String is both displayed on Character and used as
 * the `derived_object` key, so every client must serialize these exact bytes. */
export const normalize_character_name = (value: string): string => {
  const name = value.trim().toLowerCase()
  if (name.length <= 3 || name.length >= 20 || /\s|[^\x21-\x7e]/.test(name))
    throw new Error('Character names must be 4–19 non-whitespace ASCII characters.')
  return name
}

export const character_id = (name_registry_id: string, name: string): string =>
  deriveObjectID(
    name_registry_id,
    '0x1::string::String',
    bcs.String.serialize(normalize_character_name(name)).toBytes()
  )

/** The framework's permanent `Claimed(character_id)` dynamic-field marker. Querying this object
 * distinguishes an unused name from a deleted character without simulating a paid mint. */
export const character_claim_id = (name_registry_id: string, name: string): string =>
  deriveDynamicFieldID(
    name_registry_id,
    '0x2::derived_object::Claimed',
    bcs.Address.serialize(character_id(name_registry_id, name)).toBytes()
  )

export type CharacterReceipt = { digest: string; character: CharacterRow }

export type CharacterCreateCtx = {
  name: string
  classe: string
  male: boolean
  color_1: number
  color_2: number
  color_3: number
  kiosk_cap: KioskOwnerCap | null
}

/** Create returns exactly what the receipt CONTAINS — the digest and the created id from the
 *  `CharacterCreated` event. The full row is chain-initialized state the client must never
 *  invent: the server streams it (the indexer routes the event to the owner's channel). */
export const character_create = async (
  sdk: GameSdk,
  { name, classe, male, color_1, color_2, color_3, kiosk_cap }: CharacterCreateCtx
): Promise<{ digest: string; character_id: string }> => {
  const tx = sdk.tx()
  sdk.with_owner_kiosk(tx, kiosk_cap, (kiosk, cap) => {
    sdk.doors.create_character(tx, {
      payment: sdk.coin_of(tx, CHARACTER_PRICE_MIST),
      kiosk,
      cap,
      raw_name: name,
      classe,
      male,
      color_1,
      color_2,
      color_3,
    })
  })
  const receipt = await sdk.execute(tx)
  const character_id = receipt_event(receipt, '::character::CharacterCreated')?.character
  if (typeof character_id !== 'string') throw new Error('The create receipt did not expose its CharacterCreated id.')
  return { digest: receipt_digest(receipt), character_id }
}

export type CharacterActionsCtx = {
  character: CharacterRow
  kiosk_cap: KioskOwnerCap | null
}

/** The builder: one character, its progression doors. Rebuild it from the fresh row after
 *  each action. */
export const character_actions = (sdk: GameSdk, { character, kiosk_cap }: CharacterActionsCtx) => ({
  raise_stat: async (stat: CharacteristicName, amount: number): Promise<CharacterReceipt> => {
    if (amount <= 0) throw new Error('Stat amount must be positive.')
    if (character.available_points < amount) throw new Error('Not enough available stat points.')
    const tx = sdk.tx()
    sdk.with_owner_kiosk(tx, kiosk_cap, (kiosk, cap) => {
      sdk.doors.raise_stat(tx, { kiosk, cap, character_id: character.id, stat, amount })
    })
    const receipt = await sdk.execute(tx)
    return {
      digest: receipt_digest(receipt),
      character: {
        ...character,
        [stat]: character[stat] + amount,
        available_points: character.available_points - amount,
      },
    }
  },
})
