// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Its own entry: it reads the tournament rules, which the site never loads with the tournament doors.
import { tournament_coin_claims, type TournamentRow } from '@aresrpg/protocol'
import { open_team, type TournamentAction } from '@aresrpg/protocol/tournament-rules'

import type { KioskCustody } from './kiosk_runner.ts'
import type { TournamentActions } from './tournament.ts'

/** One player action of the tournament rules, sent through the door it names. `hero` is the character
 * the action names, when it names one: its custody signs, and its name titles a team it founds. */
export const run_tournament_action = (
  sdk: TournamentActions,
  t: TournamentRow,
  action: TournamentAction,
  { address, hero }: Readonly<{ address: string; hero?: Readonly<{ name?: string; custody?: KioskCustody }> }>
): Promise<unknown> => {
  const custody = hero?.custody
  const entry_fee_mist = BigInt(t.entry_fee_mist)
  const handlers: {
    [Kind in TournamentAction['kind']]: (input: Extract<TournamentAction, { kind: Kind }>) => Promise<unknown>
  } = {
    create: (input) =>
      sdk.create_team({
        tournament: t.id,
        name: input.name,
        allowed: input.allowed,
        character_id: input.character,
        custody,
        entry_fee_mist,
      }),
    join: (input) =>
      sdk.join_team({
        tournament: t.id,
        team: input.team,
        revision: input.revision,
        character_id: input.character,
        custody,
        entry_fee_mist,
      }),
    find: (input) => {
      const team = open_team(t, input.character, address)
      return team >= 0
        ? sdk.join_team({
            tournament: t.id,
            team,
            revision: t.teams[team].revision,
            character_id: input.character,
            custody,
            entry_fee_mist,
          })
        : sdk.create_team({
            tournament: t.id,
            name: hero?.name ?? input.character,
            allowed: [],
            character_id: input.character,
            custody,
            entry_fee_mist,
          })
    },
    leave: (input) => sdk.leave_team(t.id, input.team, input.character),
    enter: (input) => {
      const { fight } = t.matches[input.index]
      const args = { tournament: t.id, index: input.index, character_id: input.character, custody }
      return fight ? sdk.join({ ...args, fight }) : sdk.open(args)
    },
    crank: (input) => {
      const { fight } = t.matches[input.index]
      return fight ? sdk.crank({ tournament: t.id, index: input.index, fight }) : sdk.crank_unopened(t.id, input.index)
    },
    donate: (input) => sdk.donate(t.id, input.asset, input.amount, t.kares_pool),
    coins: (input) => {
      const { sui, kares } = tournament_coin_claims(t, input.team, input.seat)
      if (sui === 0n && kares === 0n) return Promise.resolve()
      return sdk.claim_coins(t.id, input.team, input.seat, {
        sui: sui > 0n,
        pool: kares > 0n ? t.kares_pool : null,
      })
    },
    item: (input) =>
      sdk.claim_item({
        tournament: t.id,
        team: input.team,
        seat: input.seat,
        reward: input.reward,
        template: t.rewards[input.reward].template,
      }),
    start: () => sdk.start(t.id),
    expire: () => sdk.expire(t.id, t.kares_pool),
    refund: () => (t.kares_pool ? sdk.refund_kares(t.id, t.kares_pool) : Promise.resolve()),
  }
  // The key and payload come from the same discriminated input; each table entry is checked above.
  return (handlers[action.kind] as (input: TournamentAction) => Promise<unknown>)(action)
}
