// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One explicit chat-tooltip read: fetch the linked Item plus only its stat and damage dynamic
// fields. This is presentation data, never transaction resolution state.

import { stat_names } from '@aresrpg/immutable'
import { bcs } from '@mysten/sui/bcs'

type DynamicFieldName = Readonly<{ type: string; bcs: Uint8Array }>
type ItemReadClient = Readonly<{
  core: Readonly<{
    getObjects: (input: Readonly<{ objectIds: string[]; include: { json: true } }>) => Promise<{
      objects: readonly (
        Error | Readonly<{ objectId?: string; type?: string; json?: Record<string, unknown> | null }>
      )[]
    }>
    listDynamicFields: (input: Readonly<{ parentId: string }>) => Promise<{
      dynamicFields: readonly Readonly<{ name: DynamicFieldName }>[]
    }>
    getDynamicField: (input: Readonly<{ parentId: string; name: DynamicFieldName }>) => Promise<{
      dynamicField: Readonly<{ value: Readonly<{ bcs: Uint8Array }> }>
    }>
  }>
}>

const ITEM_STATS_BCS = bcs.struct('ItemStatistics', {
  vitality: bcs.u16(),
  wisdom: bcs.u16(),
  strength: bcs.u16(),
  intelligence: bcs.u16(),
  chance: bcs.u16(),
  agility: bcs.u16(),
  range: bcs.u16(),
  movement: bcs.u16(),
  action: bcs.u16(),
  critical: bcs.u16(),
  raw_damage: bcs.u16(),
  earth_resistance: bcs.u16(),
  fire_resistance: bcs.u16(),
  water_resistance: bcs.u16(),
  air_resistance: bcs.u16(),
})

export type ItemSnapshot = Readonly<{
  id: string
  name: string
  item_type: string
  category: string
  level: number
  stats?: Readonly<Record<string, number>>
}>

export const LINKED_ITEM_CACHE_CAPACITY = 20

const dynamic_name = (
  fields: readonly Readonly<{ name: DynamicFieldName }>[],
  type_package: string,
  suffix: 'StatsKey'
): DynamicFieldName | null => fields.find(({ name }) => name.type === `${type_package}::item::${suffix}`)?.name ?? null

const item_json = (
  objects: readonly (Error | Readonly<{ objectId?: string; type?: string; json?: Record<string, unknown> | null }>)[],
  item_id: string,
  type_package: string
): Record<string, unknown> => {
  const [object] = objects
  if (
    !object ||
    object instanceof Error ||
    object.objectId !== item_id ||
    object.type !== `${type_package}::item::Item`
  )
    throw new Error('The linked item is unavailable')
  const { json } = object
  if (!json) throw new Error('The linked item has no readable content')
  return json
}

const item_stats_value = async (
  client: ItemReadClient,
  item_id: string,
  type_package: string,
  fields: readonly Readonly<{ name: DynamicFieldName }>[]
) => {
  const stats_name = dynamic_name(fields, type_package, 'StatsKey')
  return stats_name ? client.core.getDynamicField({ parentId: item_id, name: stats_name }) : null
}

const stats_record = (stats_field: Awaited<ReturnType<typeof item_stats_value>>) => {
  if (!stats_field) return undefined
  const stats = ITEM_STATS_BCS.parse(stats_field.dynamicField.value.bcs)
  return Object.freeze(Object.fromEntries(stat_names.map((name) => [name, Number(stats[name])])))
}

export const read_item_snapshot = async (
  client: ItemReadClient,
  type_package: string | null,
  item_id: string
): Promise<ItemSnapshot> => {
  if (!type_package) throw new Error('Linked items are unavailable on this network')
  const [{ objects }, { dynamicFields }] = await Promise.all([
    client.core.getObjects({ objectIds: [item_id], include: { json: true } }),
    client.core.listDynamicFields({ parentId: item_id }),
  ])
  const json = item_json(objects, item_id, type_package)
  const stats_field = await item_stats_value(client, item_id, type_package, dynamicFields)
  const stats = stats_record(stats_field)
  return Object.freeze({
    id: item_id,
    name: String(json.name),
    item_type: String(json.item_type),
    category: String(json.category),
    level: Number(json.level),
    ...(stats ? { stats } : {}),
  })
}

/** One authenticated-session LRU. Promises are cached before awaiting, so concurrent hovers,
 *  successful reads, and failures all reuse one exact request. */
export const create_item_snapshot_reader = (
  client: ItemReadClient,
  type_package: string | null,
  capacity = LINKED_ITEM_CACHE_CAPACITY
): ((item_id: string) => Promise<ItemSnapshot>) => {
  const entries = new Map<string, Promise<ItemSnapshot>>()
  return (item_id) => {
    const known = entries.get(item_id)
    if (known) {
      entries.delete(item_id)
      entries.set(item_id, known)
      return known
    }
    const pending = read_item_snapshot(client, type_package, item_id)
    entries.set(item_id, pending)
    while (entries.size > capacity) entries.delete(entries.keys().next().value!)
    return pending
  }
}
