// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- The runtime is the reducer-owned structuredClone draft and render-action builder. */

import type {
  FightContract,
  FightEventPayloads,
  FightEventType,
  FightRuntime,
  FightSources,
  RenderIdentityState,
} from './types.ts'

export const create_render_ids = (contract: FightContract): RenderIdentityState => ({
  next: 0n,
  effects: contract.fighters.map((fighter, seat) =>
    fighter.effects.map((_, index) => `initial:effect:${seat}:${index}`)
  ),
  zones: contract.zones.map((_, index) => `initial:zone:${index}`),
})

export const create_runtime = ({
  contract,
  sources,
  render_ids,
}: {
  contract: FightContract
  sources: FightSources
  render_ids?: RenderIdentityState
}): FightRuntime => ({
  contract: structuredClone(contract),
  sources,
  render_actions: [],
  error: null,
  render_ids: structuredClone(render_ids ?? create_render_ids(contract)),
})

const allocate_id = (runtime: FightRuntime, kind: 'effect' | 'zone'): string => {
  const id = `${kind}:${runtime.render_ids.next}`
  runtime.render_ids.next += 1n
  return id
}

export const add_effect_id = (runtime: FightRuntime, fighter: bigint): string => {
  const id = allocate_id(runtime, 'effect')
  runtime.render_ids.effects[Number(fighter)].push(id)
  return id
}

export const effect_id_at = (runtime: FightRuntime, fighter: bigint, index: number): string =>
  runtime.render_ids.effects[Number(fighter)][index]

export const add_zone_id = (runtime: FightRuntime): string => {
  const id = allocate_id(runtime, 'zone')
  runtime.render_ids.zones.push(id)
  return id
}

export const emit = <Type extends FightEventType>(
  runtime: FightRuntime,
  type: Type,
  payload: FightEventPayloads[Type]
): void => {
  runtime.render_actions.push({ type, payload } as FightRuntime['render_actions'][number])
}

export const fail = (runtime: FightRuntime, code: string, detail: unknown = null): FightRuntime => {
  runtime.error = { code, detail }
  return runtime
}
