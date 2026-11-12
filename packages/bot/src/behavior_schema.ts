// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { ITEM_ACTION_SCHEMAS } from './behavior_items.ts'
import { WORLD_ACTION_SCHEMAS, WORLD_REGION_SCHEMA } from './behavior_world.ts'
import { MARKET_PRICE_CONDITION_SCHEMA, MARKET_PRICE_OBSERVATION_SCHEMA } from './market_prices.ts'
import { OBJECTIVE_SCHEMA } from './objective.ts'
import { COMBAT_PROFILE_SCHEMA } from './combat_profile.ts'
import { GAMEPLAY_ACTIONS } from './gameplay.ts'
import { identifier, nonempty, decimal, object_schema, type Schema } from './gameplay_schema.ts'

const literal = (value: string): Schema => ({ const: value })
const amount: Schema = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const offer = object_schema({
  kind: { const: 'offers' },
  category: nonempty,
  item_type: nonempty,
  request: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  cursor: nonempty,
})
export const BEHAVIOR_ACTION_SCHEMA: Schema = {
  oneOf: [
    ...WORLD_ACTION_SCHEMAS,
    ...ITEM_ACTION_SCHEMAS,
    object_schema({ type: literal('observe_prices'), observation: MARKET_PRICE_OBSERVATION_SCHEMA }),
    object_schema({
      type: literal('sell'),
      character_id: identifier,
      item_type: nonempty,
      amount,
      price_mist: decimal,
      order: literal('smallest_sufficient'),
    }),
    object_schema({
      type: literal('observe_market'),
      observation: { ...offer, required: ['kind', 'category', 'item_type', 'request'] },
    }),
    object_schema({
      type: literal('buy'),
      character_id: identifier,
      item_type: nonempty,
      min_amount: amount,
      max_amount: amount,
      max_total_mist: decimal,
      order: { oneOf: [literal('lowest_total'), literal('lowest_unit')] },
    }),
    ...Object.entries(GAMEPLAY_ACTIONS).map(([kind, action]) =>
      object_schema({ type: literal('call'), kind: literal(kind), payload: action.input_schema })
    ),
    object_schema({
      type: literal('gather'),
      character_id: identifier,
      item_type: nonempty,
      order: literal('nearest'),
    }),
    object_schema({
      type: literal('engage'),
      character_id: identifier,
      mob_types: { type: 'array', items: nonempty, minItems: 1, uniqueItems: true },
      order: literal('nearest'),
    }),
    object_schema({
      type: literal('combat'),
      profiles: {
        type: 'array',
        minItems: 1,
        items: object_schema({ character_id: identifier, profile: COMBAT_PROFILE_SCHEMA }),
      },
    }),
  ],
}
const numeric: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const fact_types = {
  level: numeric,
  job_level: numeric,
  quantity: numeric,
  custody: { oneOf: [literal('kiosk'), literal('fight')] },
  ambush: { type: 'boolean' },
  fight: { type: 'boolean' },
} satisfies Record<string, Schema>
const STATE_CONDITION_SCHEMA: Schema = {
  oneOf: Object.entries(fact_types).map(([type, value]) =>
    object_schema({
      fact: object_schema({
        type: literal(type),
        character_id: identifier,
        ...(['job_level', 'quantity'].includes(type) ? { key: nonempty } : {}),
      }),
      op: { oneOf: (value === numeric ? ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] : ['eq', 'ne']).map(literal) },
      value,
    })
  ),
}
const world_fields = { character_id: identifier, world: nonempty, region: WORLD_REGION_SCHEMA }
export const BEHAVIOR_CONDITION_SCHEMA: Schema = {
  oneOf: [
    STATE_CONDITION_SCHEMA,
    object_schema({ type: literal('market_price'), ...MARKET_PRICE_CONDITION_SCHEMA.properties! }),
    object_schema({
      type: literal('world'),
      fact: {
        oneOf: [
          object_schema({ type: literal('resource_available'), ...world_fields, item_type: nonempty }),
          object_schema({
            type: literal('mob_available'),
            ...world_fields,
            mob_types: { type: 'array', items: nonempty, minItems: 1 },
          }),
        ],
      },
      op: { oneOf: [literal('eq'), literal('ne')] },
      value: { type: 'boolean' },
    }),
  ],
}
const shape = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const node = { $ref: '#/properties/script/properties/tree' }
export const BEHAVIOR_SCRIPT_SCHEMA = shape({
  version: literal('1'),
  objective: OBJECTIVE_SCHEMA,
  tree: {
    oneOf: [
      ...['sequence', 'selector'].map((type) =>
        shape({ type: literal(type), children: { type: 'array', minItems: 1, items: node } })
      ),
      shape({ type: literal('loop'), child: node }),
      shape({ type: literal('condition'), condition: BEHAVIOR_CONDITION_SCHEMA }),
      shape({ type: literal('action'), action: BEHAVIOR_ACTION_SCHEMA }),
      shape({ type: literal('wait') }),
      shape({ type: literal('complete') }),
      shape({ type: literal('replan'), reason: nonempty }),
    ],
  },
})
