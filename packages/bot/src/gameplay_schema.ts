// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { world_size } from '@aresrpg/immutable'

export type Schema = Readonly<{
  type?: 'object' | 'array' | 'string' | 'integer' | 'boolean'
  properties?: Readonly<Record<string, Schema>>
  required?: readonly string[]
  additionalProperties?: false
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  items?: Schema
  pattern?: string
  minProperties?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  const?: string | number | boolean
  oneOf?: readonly Schema[]
  description?: string
}>
/** The comparisons a condition may name: equality for any fact, order for numbers and amounts. */
const COMPARISONS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] as const
export type Comparison = (typeof COMPARISONS)[number]
export const comparison_schema = (ops: readonly Comparison[] = COMPARISONS): Schema => ({
  oneOf: ops.map((op) => ({ const: op })),
})
export const compare = <Value extends bigint | number | string | boolean>(
  op: Comparison,
  value: Value,
  threshold: Value
): boolean =>
  ({
    eq: value === threshold,
    ne: value !== threshold,
    lt: value < threshold,
    lte: value <= threshold,
    gt: value > threshold,
    gte: value >= threshold,
  })[op]
export const object_schema = (properties: Readonly<Record<string, Schema>>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
export const decimal: Schema = { type: 'string', pattern: '^(0|[1-9][0-9]*)$', maxLength: 20 }
export const identifier: Schema = { type: 'string', pattern: '^0x[0-9a-f]{64}$' }
export const nonempty: Schema = { type: 'string', minLength: 1 }
// The zone key is the existing Move u32 ABI, not a hosted product limit.
export const coordinate: Schema = { type: 'integer', minimum: 0, maximum: 4294967295 }
export const world_coordinate: Schema = { type: 'integer', minimum: 0, maximum: world_size - 1 }
const object_matches = (schema: Schema, value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    Object.keys(row).length >= (schema.minProperties ?? 0) &&
    (schema.required ?? []).every((key) => Object.hasOwn(row, key)) &&
    Object.entries(row).every(
      ([key, field]) => Object.hasOwn(schema.properties!, key) && matches(schema.properties![key]!, field)
    )
  )
}
const string_matches = (schema: Schema, value: unknown): boolean =>
  typeof value === 'string' &&
  value.length >= (schema.minLength ?? 0) &&
  value.length <= (schema.maxLength ?? Infinity) &&
  (!schema.pattern || new RegExp(schema.pattern).test(value))
const type_matches: Record<NonNullable<Schema['type']>, (schema: Schema, value: unknown) => boolean> = {
  boolean: (_schema, value) => typeof value === 'boolean',
  object: object_matches,
  string: string_matches,
  array: (schema, value) =>
    Array.isArray(value) &&
    value.length >= (schema.minItems ?? 0) &&
    value.length <= (schema.maxItems ?? Infinity) &&
    (!schema.uniqueItems || new Set(value).size === value.length) &&
    value.every((entry) => matches(schema.items!, entry)),
  integer: (schema, value) =>
    typeof value === 'number' &&
    [Number.isSafeInteger(value), value >= schema.minimum!, value <= schema.maximum!].every(Boolean),
}
/** A schema with no type, `oneOf` or `const` accepts any value, as in JSON Schema. */
export const matches = (schema: Schema, value: unknown): boolean => {
  if (schema.oneOf) return schema.oneOf.filter((candidate) => matches(candidate, value)).length === 1
  if (schema.const !== undefined) return value === schema.const
  return schema.type ? type_matches[schema.type](schema, value) : true
}
export const u64 = (value: string): bigint => {
  const integer = BigInt(value)
  if (integer > 18446744073709551615n) throw new Error('invalid_u64')
  return integer
}
export const decode = <T>(schema: Schema, value: unknown): T => {
  if (!matches(schema, value)) throw new Error('invalid_gameplay_payload')
  return structuredClone(value) as T
}
