// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type Base = Readonly<{ id: string; digest: string; ts_ms: number }>
export type Sale = Base &
  Readonly<{
    kind: 'sale'
    asset_kind: 'item' | 'character'
    seller: string
    name: string
    item_type: string | null
    amount: number
    price_mist: string
  }>
export type Gathering = Base & Readonly<{ kind: 'gather'; address: string; item_type: string; world: string }>
export type Victory = Base &
  Readonly<{
    kind: 'victory'
    fight: string
    dungeon: string
    winners: readonly string[]
    mob_types: readonly string[]
  }>
export type Loot = Base &
  Readonly<{
    kind: 'loot'
    address: string
    object: string
    item_type: string
    name: string
    category: string
    level: number
    stats: Readonly<Record<string, number>>
  }>
export type Notification = Sale | Gathering | Victory | Loot

export const integer = (value: unknown): number => {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid feed integer')
  return parsed
}
export const text = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('Invalid feed text')
  return value
}
const address = (value: unknown) => text(value, /^0x[0-9a-f]{64}$/)
const slug = (value: unknown) => text(value, /^[a-z0-9_]+$/)
const name = (value: unknown) => text(value, /^.{1,512}$/s)
const strings = (value: unknown, parse: (item: unknown) => string, limit: number): readonly string[] => {
  if (!Array.isArray(value) || !value.length || value.length > limit) throw new Error('Invalid notification list')
  return value.map(parse)
}
const parse_sale = (row: Readonly<Record<string, unknown>>, base: Base): Sale => {
  const amount = integer(row.amount)
  const price_mist = text(row.price_mist, /^[1-9]\d*$/)
  if (!amount || BigInt(price_mist) > 18_446_744_073_709_551_615n) throw new Error('Invalid sale amount')
  if (row.asset_kind !== 'item' && row.asset_kind !== 'character') throw new Error('Invalid sale kind')
  return {
    ...base,
    kind: 'sale',
    asset_kind: row.asset_kind,
    seller: address(row.seller),
    name: name(row.name),
    item_type: row.item_type === null ? null : slug(row.item_type),
    amount,
    price_mist,
  }
}
const parse_stats = (value: unknown): Readonly<Record<string, number>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid loot stats')
  return Object.fromEntries(
    Object.entries(value).map(([key, amount]) => {
      if (!Number.isSafeInteger(amount) || amount < -32768 || amount > 32767)
        throw new Error('Invalid rolled statistic')
      return [slug(key), amount as number]
    })
  )
}
export const parse_notification = (value: unknown): Notification => {
  if (!value || typeof value !== 'object') throw new Error('Invalid notification')
  const row = value as Record<string, unknown>
  const base = {
    id: text(row.id, /^\d+:\d+:(?:\d+|0x[0-9a-f]{64}):(sale|event|loot)$/),
    digest: text(row.digest, /^[1-9A-HJ-NP-Za-km-z]{32,50}$/),
    ts_ms: integer(row.ts_ms),
  }
  switch (row.kind) {
    case 'sale':
      return parse_sale(row, base)
    case 'gather':
      return {
        ...base,
        kind: 'gather',
        address: address(row.address),
        item_type: slug(row.item_type),
        world: slug(row.world),
      }
    case 'victory':
      return {
        ...base,
        kind: 'victory',
        fight: address(row.fight),
        dungeon: slug(row.dungeon),
        winners: strings(row.winners, address, 6),
        mob_types: strings(row.mob_types, slug, 32),
      }
    case 'loot':
      return {
        ...base,
        kind: 'loot',
        address: address(row.address),
        object: address(row.object),
        item_type: slug(row.item_type),
        name: name(row.name),
        category: slug(row.category),
        level: integer(row.level),
        stats: parse_stats(row.stats),
      }
    default:
      throw new Error('Unknown notification kind')
  }
}
