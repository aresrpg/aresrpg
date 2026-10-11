// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import type { AnalyticsEvent } from '../analytics.ts'
import type { AppState } from '../store.ts'

export type FightObservation = Readonly<{
  ended: boolean
  round: number
  turn: number
  at_ms: number
  owned_turn: boolean
  control: 'manual' | 'automatic'
  fight_kind: 'dungeon' | 'kolizeum' | 'world'
  outcome: 'victory' | 'defeat'
  duration_ms: number | null
  party_size: number
}>

/** Keep only the analytical slice of accepted canonical checkpoints, never the speculative fight twin. */
export const observe_fight = (
  state: AppState,
  checkpoint: Readonly<HydratedFightCheckpoint>
): FightObservation | null => {
  const { contract } = checkpoint
  const { wallet } = state.session
  if (!wallet) return null
  const owned = contract.fighters.filter(({ kind }) => kind.type === 'player' && kind.owner === wallet.address)
  if (!owned.length) return null
  const active = contract.fighters[Number(contract.queue[Number(contract.turn_ptr)])]
  const automatic =
    state.analytics.fights[contract.id]?.control === 'automatic' ||
    owned.some(({ kind }) => kind.type === 'player' && kind.character === state.automation.run?.character_id)
  return {
    ended: contract.ended,
    round: Number(contract.round),
    turn: Number(contract.turn_ptr),
    at_ms: Number(contract.turn_started_ms),
    owned_turn: owned.some((fighter) => fighter === active),
    control: automatic ? 'automatic' : 'manual',
    fight_kind: contract.dungeon ? 'dungeon' : contract.managed ? 'kolizeum' : 'world',
    outcome: owned.some(({ team }) => team === contract.winner) ? 'victory' : 'defeat',
    duration_ms:
      contract.started_ms === null
        ? null
        : contract.ended_ms === null
          ? null
          : Math.max(0, Number(contract.ended_ms - contract.started_ms)),
    party_size: contract.fighters.filter((fighter) => fighter.team === owned[0]!.team).length,
  }
}

export const fold_fight_observation = (
  observations: Readonly<Record<string, FightObservation>>,
  id: string,
  next: FightObservation
): Readonly<Record<string, FightObservation>> => {
  const before = observations[id]
  if (before?.ended || (before && (next.round < before.round || next.at_ms < before.at_ms))) return observations
  if (before && Object.entries(next).every(([key, value]) => before[key as keyof FightObservation] === value))
    return observations
  return { ...observations, [id]: next }
}

export const fight_events = (state: AppState, previous: AppState): readonly AnalyticsEvent[] =>
  Object.entries(state.analytics.fights).flatMap(([id, next]): readonly AnalyticsEvent[] => {
    const before = previous.analytics.fights[id]
    if (!before || before === next) return []
    const properties = { fight_kind: next.fight_kind, party_size: next.party_size, control: next.control }
    return [
      ...(before.round === 0 && next.round > 0 ? [{ name: 'fight_started', properties }] : []),
      ...(before.round > 0 && before.owned_turn && (next.round > before.round || next.turn !== before.turn)
        ? [{ name: 'fight_turn_completed', properties }]
        : []),
      ...(next.ended && !before.ended
        ? [
            {
              name: 'fight_completed',
              properties: { ...properties, outcome: next.outcome, rounds: next.round, duration_ms: next.duration_ms },
            },
          ]
        : []),
    ]
  })
