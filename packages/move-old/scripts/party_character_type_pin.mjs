// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { bcs } from '@mysten/sui/bcs'

import { character_type } from '../../sdk/src/deployment/aresrpg.js'

export const PARTY_CHARACTER_TYPE_TARGET = 'admin::admin_set_party_character_type'

export class PartyCharacterTypePinMissingError extends Error {
  name = 'PartyCharacterTypePinMissingError'
}

export class PartyCharacterTypePinMismatchError extends Error {
  name = 'PartyCharacterTypePinMismatchError'
}

export function party_character_type(M) {
  return character_type({ PACKAGE_ID: M.aresrpg.pkg })
}

function party_character_type_bytes(M) {
  // std::type_name::with_defining_ids writes the canonical full-width type without the display-only `0x`.
  return bcs.string().serialize(party_character_type(M).replace(/^0x/, '')).toBytes()
}

export async function assert_party_character_type_pin(client, M) {
  const parentId = M.social.version
  const keyType = `${M.social.pkg}::version::PartyCharacterTypeKey`
  let cursor = null
  let entry
  do {
    const page = await client.listDynamicFields({ parentId, cursor })
    entry = page.dynamicFields?.find((field) => field.name?.type === keyType)
    cursor = entry || !page.hasNextPage ? null : page.cursor
  } while (cursor)

  if (!entry)
    throw new PartyCharacterTypePinMissingError(`Party character-type pin is missing from social Version ${parentId}`)

  const { dynamicField } = await client.getDynamicField({ parentId, name: entry.name })
  const actual = dynamicField?.value?.bcs
  if (!actual)
    throw new PartyCharacterTypePinMissingError(
      `Party character-type pin has no readable value on social Version ${parentId}`
    )

  const expected = party_character_type_bytes(M)
  const matches = actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  if (!matches)
    throw new PartyCharacterTypePinMismatchError(
      `Party character-type pin on social Version ${parentId} does not byte-equal ${party_character_type(M)}`
    )

  return party_character_type(M)
}
