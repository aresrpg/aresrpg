// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { isValidSuiObjectId, normalizeStructTag } from '@mysten/sui/utils'

import type { EquipChange } from './character_actions.ts'

export const decode_agent_equipment = (json: Record<string, unknown> | null | undefined): readonly EquipChange[] => {
  const value = json?.value as { contents?: unknown } | undefined
  if (!Array.isArray(value?.contents)) throw new Error('Character equipment is unavailable.')
  return Object.freeze(
    value.contents.map((entry: { key?: unknown; value?: { item?: unknown } }) => {
      const { key: slot, value: record } = entry
      if (typeof slot !== 'string' || typeof record?.item !== 'string' || !isValidSuiObjectId(record.item))
        throw new Error('Character equipment is malformed.')
      return Object.freeze({ slot, item_id: record.item })
    })
  )
}

/** The exact equipment map used by naked_rule. Missing field means never equipped;
 * failed reads and incomplete pagination never masquerade as a naked character. */
const find_equipment_field = async (client: SuiGrpcClient, type_package: string, character_id: string) => {
  const type = normalizeStructTag(`${type_package}::equipment::EquipmentKey`)
  const seen = new Set<string>()
  let cursor: string | null | undefined
  do {
    const page = await client.core.listDynamicFields({ parentId: character_id, cursor })
    const field = page.dynamicFields.find((row) => normalizeStructTag(row.name.type) === type)
    if (field) return field
    cursor = page.hasNextPage ? page.cursor : null
    if (page.hasNextPage && (!cursor || seen.has(cursor))) throw new Error('Equipment pagination changed.')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return null
}

export const read_agent_equipment = async (client: SuiGrpcClient, type_package: string, character_id: string) => {
  const field = await find_equipment_field(client, type_package, character_id)
  if (!field) return Object.freeze([]) as readonly EquipChange[]
  const {
    objects: [object],
  } = await client.core.getObjects({ objectIds: [field.fieldId], include: { json: true } })
  if (!object || object instanceof Error || object.objectId !== field.fieldId)
    throw new Error('Character equipment read failed.')
  return decode_agent_equipment(object.json)
}
