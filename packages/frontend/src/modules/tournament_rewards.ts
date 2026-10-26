// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { tournament_coin_claims, type TournamentRow } from '@aresrpg/protocol'
import { receipt_digest, type Receipt } from '@aresrpg/sdk/cache'

import type { AppInput, AppState } from '../store.ts'

import type { TournamentAction } from './tournament.ts'

export type CollectedReward = Readonly<
  { asset: 'sui' | 'kares'; amount: bigint } | { asset: 'item'; amount: bigint; template: string }
>
export type TournamentCollection = Readonly<{
  digest: string
  tournament: string
  rewards: readonly CollectedReward[]
  /** Presentation acknowledgement; retained for receipt deduplication until the wallet changes. */
  acknowledged?: boolean
}>

/** A successful claim certifies its frozen entitlement. Gas and unrelated wallet deltas are excluded. */
export const collected_tournament_rewards = (
  row: TournamentRow,
  action: TournamentAction,
  result: unknown,
  address: string
): TournamentCollection | null => {
  if (!('seat' in action)) return null
  const receipt = result as Receipt | undefined
  // The SDK's certified result union already separates successful and failed execution.
  if (receipt?.$kind !== 'Transaction') return null
  if (row.teams[action.team].seats[action.seat].owner !== address) return null
  const digest = receipt_digest(receipt)
  const rewards: readonly CollectedReward[] =
    action.kind === 'coins'
      ? Object.entries(tournament_coin_claims(row, action.team, action.seat)).flatMap(([asset, amount]) =>
          amount > 0n ? [{ asset: asset as 'sui' | 'kares', amount }] : []
        )
      : [
          {
            asset: 'item',
            template: row.rewards[action.reward].template,
            amount: BigInt(row.rewards[action.reward].amount),
          },
        ]
  return rewards.length ? { digest, tournament: row.id, rewards } : null
}

export const combined_tournament_rewards = (
  collections: readonly TournamentCollection[]
): readonly CollectedReward[] => {
  const totals = new Map<string, CollectedReward>()
  collections
    .flatMap((collection) => collection.rewards)
    .forEach((reward) => {
      const key = reward.asset === 'item' ? reward.template : reward.asset
      totals.set(key, { ...reward, amount: reward.amount + (totals.get(key)?.amount ?? 0n) })
    })
  const order = { sui: 0, kares: 1, item: 2 }
  return [...totals.values()].toSorted((a, b) => order[a.asset] - order[b.asset])
}

export const tournament_presentation_available = (
  state: Pick<AppState, 'fight' | 'fight_result' | 'navigation'>
): boolean =>
  !state.fight.mounted &&
  state.navigation.dialog === null &&
  !Object.values(state.fight_result.current_by_character).some((result) => result.result_open || result.level_up_open)

export const pending_tournament_presentation = (state: AppState): AppInput | null => {
  if (!tournament_presentation_available(state) || state.tournament.pending !== null) return null
  if (state.tournament.pending_podium) return { type: 'tournament/podium_opened', id: state.tournament.pending_podium }
  return state.tournament.collections.some((row) => !row.acknowledged) && state.tournament.reward_reveal.length === 0
    ? { type: 'tournament/rewards_opened' }
    : null
}
