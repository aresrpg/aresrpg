// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The JSON boundary for live human fight actions. The runtime remains bigint-native; the
// websocket carries exact decimal strings and decodes once before entering Fight.apply.

import type { FightCommandInput, FightInput, TurnWitness } from './fight.ts'

type StreamedActionType = 'place' | 'ready' | 'move_to' | 'cast_spell' | 'weapon_strike' | 'end_turn' | 'forfeit'

export type FightStreamInput = Extract<FightCommandInput, { type: StreamedActionType }>

type WireWitness = Readonly<{ fighter: string; seed: string }>
type WireTiming = Readonly<{ observed_ms?: string; turn_witnesses?: readonly WireWitness[] }>

export type FightWireAction = WireTiming &
  (
    | Readonly<{ type: 'place'; fighter: string; cell: string }>
    | Readonly<{ type: 'ready'; fighter: string }>
    | Readonly<{ type: 'move_to'; fighter: string; path: readonly string[] }>
    | Readonly<{ type: 'cast_spell'; fighter: string; spell: string; target_cell: string }>
    | Readonly<{ type: 'weapon_strike'; fighter: string; target_cell: string }>
    | Readonly<{ type: 'end_turn'; fighter: string }>
    | Readonly<{ type: 'forfeit'; fighter: string }>
  )

const as_record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('fight action must be an object')
  return value as Readonly<Record<string, unknown>>
}

const as_decimal = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new Error(`fight action ${field} must be an unsigned decimal string`)
  return value
}

const as_text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`fight action ${field} must be a non-empty string`)
  return value
}

const encode_witnesses = (witnesses: readonly TurnWitness[] | undefined): readonly WireWitness[] | undefined =>
  witnesses?.map(({ fighter, seed }) => Object.freeze({ fighter: fighter.toString(), seed: seed.toString() }))

const encode_timing = (input: FightCommandInput): WireTiming =>
  Object.freeze({
    ...(input.observed_ms === undefined ? {} : { observed_ms: input.observed_ms.toString() }),
    ...(input.turn_witnesses === undefined ? {} : { turn_witnesses: encode_witnesses(input.turn_witnesses) }),
  })

export const encode_fight_action = (input: FightInput): FightWireAction => {
  if (input.type === 'turn_seed' || input.type === 'join' || input.type === 'start' || input.type === 'crank')
    throw new Error(`fight action ${input.type} is not streamable`)
  const timing = encode_timing(input)
  if (input.type === 'place')
    return Object.freeze({
      ...timing,
      type: input.type,
      fighter: input.fighter.toString(),
      cell: input.cell.toString(),
    })
  if (input.type === 'ready' || input.type === 'end_turn' || input.type === 'forfeit')
    return Object.freeze({ ...timing, type: input.type, fighter: input.fighter.toString() })
  if (input.type === 'move_to')
    return Object.freeze({
      ...timing,
      type: input.type,
      fighter: input.fighter.toString(),
      path: Object.freeze(input.path.map(String)),
    })
  if (input.type === 'cast_spell')
    return Object.freeze({
      ...timing,
      type: input.type,
      fighter: input.fighter.toString(),
      spell: input.spell,
      target_cell: input.target_cell.toString(),
    })
  return Object.freeze({
    ...timing,
    type: input.type,
    fighter: input.fighter.toString(),
    target_cell: input.target_cell.toString(),
  })
}

export const fight_action_to_wire = (input: FightInput): FightWireAction | null =>
  input.type === 'turn_seed' || input.type === 'join' || input.type === 'start' || input.type === 'crank'
    ? null
    : encode_fight_action(input)

const decode_witnesses = (value: unknown): readonly TurnWitness[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) throw new Error('fight action turn_witnesses must be an array')
  return Object.freeze(
    value.map((entry) => {
      const witness = as_record(entry)
      return Object.freeze({
        fighter: BigInt(as_decimal(witness.fighter, 'turn_witnesses.fighter')),
        seed: BigInt(as_decimal(witness.seed, 'turn_witnesses.seed')),
      })
    })
  )
}

const decode_timing = (action: Readonly<Record<string, unknown>>) =>
  Object.freeze({
    ...(action.observed_ms === undefined ? {} : { observed_ms: BigInt(as_decimal(action.observed_ms, 'observed_ms')) }),
    ...(action.turn_witnesses === undefined ? {} : { turn_witnesses: decode_witnesses(action.turn_witnesses) }),
  })

export const decode_fight_action = (value: unknown): FightStreamInput => {
  const action = as_record(value)
  const { type } = action
  const timing = decode_timing(action)
  const fighter = BigInt(as_decimal(action.fighter, 'fighter'))
  if (type === 'place')
    return Object.freeze({ ...timing, type, fighter, cell: BigInt(as_decimal(action.cell, 'cell')) })
  if (type === 'ready' || type === 'end_turn' || type === 'forfeit') return Object.freeze({ ...timing, type, fighter })
  if (type === 'move_to') {
    if (!Array.isArray(action.path) || action.path.length > 380) throw new Error('fight action path must be an array')
    return Object.freeze({
      ...timing,
      type,
      fighter,
      path: Object.freeze(action.path.map((cell) => BigInt(as_decimal(cell, 'path cell')))),
    })
  }
  if (type === 'cast_spell')
    return Object.freeze({
      ...timing,
      type,
      fighter,
      spell: as_text(action.spell, 'spell'),
      target_cell: BigInt(as_decimal(action.target_cell, 'target_cell')),
    })
  if (type === 'weapon_strike')
    return Object.freeze({
      ...timing,
      type,
      fighter,
      target_cell: BigInt(as_decimal(action.target_cell, 'target_cell')),
    })
  throw new Error(`fight action type ${String(type)} is not streamable`)
}

/** Validate untrusted JSON and return one canonical wire value. */
export const parse_fight_wire_action = (value: unknown): FightWireAction =>
  encode_fight_action(decode_fight_action(value))
