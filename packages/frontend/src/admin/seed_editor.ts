// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type SeedDomain = 'airdrop' | 'items' | 'mobs' | 'recipes' | 'shop' | 'spells' | 'worlds'
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>
export type JsonPath = readonly (string | number)[]

export type SeedEntityRow = Readonly<{
  id: string
  label: string
  path: JsonPath
  value: JsonValue
}>

export type EntityAssetReference =
  | Readonly<{ kind: 'item'; id: string }>
  | Readonly<{ kind: 'mob'; id: string }>
  | Readonly<{ kind: 'spell'; classe: string; name: string }>

export const admin_content_domains = Object.freeze([
  Object.freeze({ id: 'airdrop', file: 'airdrop.json', label: 'Airdrop' }),
  Object.freeze({ id: 'items', file: 'items.json', label: 'Items' }),
  Object.freeze({ id: 'mobs', file: 'mobs.json', label: 'Mobs' }),
  Object.freeze({ id: 'recipes', file: 'recipes.json', label: 'Recipes' }),
  Object.freeze({ id: 'shop', file: 'shop.json', label: 'Shop' }),
  Object.freeze({ id: 'spells', file: 'spells.json', label: 'Spells' }),
  Object.freeze({ id: 'worlds', file: 'worlds.json', label: 'Worlds' }),
] as const)

export type SeedFileName = (typeof admin_content_domains)[number]['file']
const seed_file_names = new Set<SeedFileName>(admin_content_domains.map(({ file }) => file))
export const is_seed_file = (
  file: Readonly<{ file: string; revision: string; value: JsonValue }>
): file is Readonly<{ file: SeedFileName; revision: string; value: JsonValue }> =>
  seed_file_names.has(file.file as SeedFileName)

const row_name = (domain: SeedDomain, value: Readonly<Record<string, JsonValue>>, index: number): string => {
  const key =
    domain === 'items'
      ? 'item_type'
      : domain === 'mobs'
        ? 'mob_type'
        : domain === 'spells'
          ? 'name'
          : domain === 'recipes'
            ? 'output_type'
            : domain === 'worlds'
              ? 'world'
              : domain === 'shop'
                ? 'item_type'
                : 'id'
  const identity = value[key]
  return typeof identity === 'string' && identity.length > 0 ? identity : `${domain}-${index + 1}`
}

const as_object = (value: JsonValue): Readonly<Record<string, JsonValue>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : null

const string_field = (value: Readonly<Record<string, JsonValue>>, key: string): string | null =>
  typeof value[key] === 'string' && value[key].length > 0 ? value[key] : null

export const is_readonly_seed_path = (domain: SeedDomain, path: JsonPath): boolean =>
  domain === 'items' && path.length === 1 && path[0] === 'item_type'

export const entity_asset_reference = (domain: SeedDomain, value: JsonValue): EntityAssetReference | null => {
  const object = as_object(value)
  if (!object) return null
  if (domain === 'items' || domain === 'shop') {
    const id = string_field(object, 'item_type')
    return id ? Object.freeze({ kind: 'item', id }) : null
  }
  if (domain === 'recipes') {
    const id = string_field(object, 'output_type')
    return id ? Object.freeze({ kind: 'item', id }) : null
  }
  if (domain === 'mobs') {
    const id = string_field(object, 'mob_type')
    return id ? Object.freeze({ kind: 'mob', id }) : null
  }
  if (domain === 'spells') {
    const classe = string_field(object, 'classe')
    const name = string_field(object, 'name')
    return classe && name ? Object.freeze({ kind: 'spell', classe, name }) : null
  }
  if (domain === 'airdrop') {
    const id = string_field(object, 'id')
    return id ? Object.freeze({ kind: 'item', id }) : null
  }
  return null
}

const array_rows = (
  domain: SeedDomain,
  values: readonly JsonValue[],
  prefix: JsonPath = []
): readonly SeedEntityRow[] =>
  values.map((value, index) => {
    const object = as_object(value) ?? (Object.freeze({}) as Readonly<Record<string, JsonValue>>)
    const id = row_name(domain, object, index)
    const human_name = object.name
    return Object.freeze({
      id,
      label: typeof human_name === 'string' && human_name.length > 0 ? human_name : id,
      path: Object.freeze([...prefix, index]),
      value,
    })
  })

export const entity_rows = (domain: SeedDomain, value: unknown): readonly SeedEntityRow[] => {
  const json = value as JsonValue
  if (Array.isArray(json)) return array_rows(domain, json)
  const object = as_object(json)
  if (!object) return []
  if (domain === 'shop') return array_rows(domain, Array.isArray(object.sales) ? object.sales : [], ['sales'])
  if (domain === 'airdrop')
    return ['drops', 'giftcards', 'legacy_pool', 'pending', 'showcase'].flatMap((section) => {
      const rows = object[section]
      if (!Array.isArray(rows)) return []
      return array_rows(domain, rows, [section]).map((row) =>
        Object.freeze({ ...row, id: `${section}:${row.id}`, label: `${section} · ${row.label}` })
      )
    })
  return Object.entries(object).map(([key, child]) =>
    Object.freeze({ id: key, label: key, path: Object.freeze([key]), value: child })
  )
}

export const editable_json_paths = (value: unknown, path: JsonPath = []): readonly string[] => {
  if (value === null || typeof value !== 'object') return [path.join('.')]
  return Object.entries(value).flatMap(([key, child]) =>
    editable_json_paths(child, [...path, Array.isArray(value) ? Number(key) : key])
  )
}

export const json_value_at_path = (value: JsonValue, path: JsonPath): JsonValue =>
  path.reduce<JsonValue>((current, segment) => {
    if (current === null || typeof current !== 'object') throw new TypeError(`Cannot read JSON path ${path.join('.')}`)
    const next = Array.isArray(current)
      ? current[Number(segment)]
      : (current as Readonly<Record<string, JsonValue>>)[String(segment)]
    if (next === undefined) throw new TypeError(`Unknown JSON path ${path.join('.')}`)
    return next
  }, value)

export const replace_json_value = (value: JsonValue, path: JsonPath, replacement: JsonValue): JsonValue => {
  if (path.length === 0) return replacement
  if (value === null || typeof value !== 'object') throw new TypeError(`Cannot replace JSON path ${path.join('.')}`)
  const [segment, ...rest] = path
  if (Array.isArray(value)) {
    const index = Number(segment)
    if (!Number.isInteger(index) || index < 0 || index >= value.length)
      throw new TypeError(`Unknown JSON path ${path.join('.')}`)
    return Object.freeze(
      value.map((child, child_index) => (child_index === index ? replace_json_value(child, rest, replacement) : child))
    )
  }
  const key = String(segment)
  if (!(key in value)) throw new TypeError(`Unknown JSON path ${path.join('.')}`)
  return Object.freeze({
    ...value,
    [key]: replace_json_value((value as Readonly<Record<string, JsonValue>>)[key], rest, replacement),
  })
}

export const remove_json_value = (value: JsonValue, path: JsonPath): JsonValue => {
  if (path.length === 0) throw new TypeError('The corpus root cannot be removed')
  const parent_path = path.slice(0, -1)
  const leaf = path[path.length - 1]
  const parent = json_value_at_path(value, parent_path)
  if (Array.isArray(parent))
    return replace_json_value(
      value,
      parent_path,
      parent.filter((_, index) => index !== Number(leaf))
    )
  const object = as_object(parent)
  if (!object || !(String(leaf) in object)) throw new TypeError(`Unknown JSON path ${path.join('.')}`)
  return replace_json_value(
    value,
    parent_path,
    Object.freeze(Object.fromEntries(Object.entries(object).filter(([key]) => key !== String(leaf))))
  )
}
