// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_item_category, max_level, type ItemCategory } from '@aresrpg/immutable'

export const MARKET_GROUP_PAGE_SIZE = 20
export const MARKET_OFFERS_PER_GROUP = 3
/** One page of public listings: an item type's offers, or the listed heroes. */
export type MarketQuery =
  | Readonly<{ kind: 'offers'; category: ItemCategory; item_type: string; cursor?: string }>
  | Readonly<{ kind: 'characters'; cursor?: string; classe?: string; min_level?: number; max_level?: number }>
/** One open market surface. Every observation receives the listed types; a query also receives its
 *  page. `types` is a surface that reads the listed types alone. */
export type MarketObservation = (MarketQuery | Readonly<{ kind: 'types' }>) & Readonly<{ request: number }>
/** One listed type at a glance. `lots` maps each paid standard lot size to the cheapest public asking
 *  price of a lot of that size, in total mist; `units` counts every publicly listed unit; `change_bps`
 *  is the last full UTC day's average unit sale price against the day before, in basis points, null
 *  unless the type sold on both days. Viewer-free: own listings count like any other. */
export type MarketQuote = Readonly<{ lots: Readonly<Record<string, string>>; units: number; change_bps: number | null }>
export type MarketType = Readonly<{
  item_type: string
  category: ItemCategory
  name: string
  level: number
  quote: MarketQuote
}>
/** Wire schema of the page queries for connectors; semantic parsing remains parse_market_observation. */
export const MARKET_OBSERVATION_SCHEMA = {
  oneOf: [
    { type: 'null' },
    ...[
      {
        kind: 'offers',
        fields: { category: { type: 'string' }, item_type: { type: 'string' }, cursor: { type: 'string' } },
        required: ['category', 'item_type'],
      },
      {
        kind: 'characters',
        fields: {
          cursor: { type: 'string' },
          classe: { type: 'string' },
          min_level: { type: 'integer' },
          max_level: { type: 'integer' },
        },
        required: [],
      },
    ].map(({ kind, fields, required }) => ({
      type: 'object',
      properties: { kind: { const: kind }, request: { type: 'integer', minimum: 0 }, ...fields },
      required: ['kind', 'request', ...required],
      additionalProperties: false,
    })),
  ],
} as const
export const has_market_page = (
  observation: MarketObservation | MarketQuery | null
): observation is Extract<MarketObservation, { kind: MarketQuery['kind'] }> =>
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
const parse_offers = (row: Readonly<Record<string, unknown>>): MarketQuery => {
  const item_type = optional_text(row.item_type, 128, /^[a-z0-9_]+$/)
  if (!item_type) throw new Error('invalid market item type')
  if (typeof row.category !== 'string' || !is_item_category(row.category)) throw new Error('invalid market category')
  return { kind: 'offers', category: row.category, item_type, cursor: optional_text(row.cursor, 4096) }
}
type Parsed = MarketQuery | Readonly<{ kind: 'types' }>
const PARSERS = Object.freeze<Record<string, (row: Readonly<Record<string, unknown>>) => Parsed>>({
  types: () => ({ kind: 'types' }),
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
