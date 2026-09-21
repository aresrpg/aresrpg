// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_item_category, max_level, type ItemCategory } from '@aresrpg/immutable'

export const MARKET_GROUP_PAGE_SIZE = 20
export const MARKET_OFFERS_PER_GROUP = 3
export type MarketQuery =
  | Readonly<{ kind: 'overview' }>
  | Readonly<{ kind: 'types'; category: ItemCategory }>
  | Readonly<{ kind: 'offers'; category: ItemCategory; item_type: string; cursor?: string }>
  | Readonly<{ kind: 'characters'; cursor?: string; classe?: string; min_level?: number; max_level?: number }>
export type MarketObservation = MarketQuery & Readonly<{ request: number }>
export type MarketTypeCounts = Readonly<Partial<Record<ItemCategory, number>>>
export type MarketType = Readonly<{ item_type: string; category: ItemCategory; name: string; level: number }>
export const market_category = (observation: MarketQuery | null): ItemCategory | null =>
  observation && (observation.kind === 'types' || observation.kind === 'offers') ? observation.category : null
export const has_market_page = (
  observation: MarketQuery | null
): observation is Extract<MarketQuery, { kind: 'offers' | 'characters' }> =>
  observation?.kind === 'offers' || observation?.kind === 'characters'

const optional_text = (value: unknown, limit: number, pattern?: RegExp): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > limit || (pattern && !pattern.test(value)))
    throw new Error('invalid market text filter')
  return value
}
const level_filter = (value: unknown): number | undefined => {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max_level)
    throw new Error('invalid market level filter')
  return Number(value)
}
const category_of = (value: unknown): ItemCategory => {
  if (typeof value !== 'string' || !is_item_category(value)) throw new Error('invalid market category')
  return value
}
const parse_offers = (row: Readonly<Record<string, unknown>>): MarketQuery => {
  const item_type = optional_text(row.item_type, 128, /^[a-z0-9_]+$/)
  if (!item_type) throw new Error('invalid market item type')
  return { kind: 'offers', category: category_of(row.category), item_type, cursor: optional_text(row.cursor, 4096) }
}
const PARSERS = Object.freeze<Record<string, (row: Readonly<Record<string, unknown>>) => MarketQuery>>({
  overview: () => ({ kind: 'overview' }),
  types: (row) => ({ kind: 'types', category: category_of(row.category) }),
  offers: parse_offers,
  characters: (row) => ({
    kind: 'characters',
    cursor: optional_text(row.cursor, 4096),
    classe: optional_text(row.classe, 32, /^[a-z]+$/),
    min_level: level_filter(row.min_level),
    max_level: level_filter(row.max_level),
  }),
})
export const parse_market_observation = (value: unknown): MarketObservation | null => {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('market observation must be an object or null')
  const row = value as Record<string, unknown>
  if (!Number.isSafeInteger(row.request) || Number(row.request) < 0)
    throw new Error('market observation needs a request identity')
  if (typeof row.kind !== 'string' || !Object.hasOwn(PARSERS, row.kind))
    throw new Error('invalid market observation kind')
  return { ...PARSERS[row.kind]!(row), request: Number(row.request) }
}
