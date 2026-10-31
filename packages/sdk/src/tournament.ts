// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SDK, living_content } from './client.ts'
import { receipt_digest, receipt_event } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { project_fight_boundary_receipt } from './fight.ts'
import { board_catalog_id } from './seed_ids.ts'
import { kares_payment } from './kares_ptb.ts'

type GameSdk = ReturnType<typeof SDK>
type Match = Readonly<{ tournament: string; index: number; fight: string }>
type Seat = Readonly<{ fighter_idx: bigint; custody?: KioskCustody }>

export const tournament_actions = (sdk: GameSdk, { kiosk_cap }: Readonly<{ kiosk_cap: KioskCapLoader }>) => {
  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)
  const submit = async (ids: readonly string[], compose: (tx: ReturnType<GameSdk['tx']>) => void) => {
    await sdk.hydrate_unknown([...ids])
    const tx = sdk.tx()
    compose(tx)
    return sdk.execute(tx, { gas_scope: `tournament:${ids[0]}` })
  }
  return Object.freeze({
    start: (tournament: string) => submit([tournament], (tx) => sdk.doors.start_tournament(tx, { tournament })),
    create_team: async (
      args: Readonly<{
        tournament: string
        name: string
        allowed: readonly string[]
        character_id: string
        entry_fee_mist?: bigint
        custody?: KioskCustody
      }>
    ) => {
      await sdk.hydrate_unknown([args.tournament])
      return with_kiosk(
        (tx, kiosk, cap) =>
          sdk.doors.register_tournament(tx, {
            ...args,
            team: null,
            revision: 0,
            payment: sdk.coin_of(tx, args.entry_fee_mist ?? 0n),
            kiosk,
            cap,
          }),
        {
          custody: args.custody,
          gas_scope: `tournament:${args.tournament}`,
        }
      )
    },
    join_team: async (
      args: Readonly<{
        tournament: string
        team: number
        revision: string
        character_id: string
        entry_fee_mist?: bigint
        custody?: KioskCustody
      }>
    ) => {
      await sdk.hydrate_unknown([args.tournament])
      return with_kiosk(
        (tx, kiosk, cap) =>
          sdk.doors.register_tournament(tx, {
            ...args,
            name: '',
            allowed: [],
            payment: sdk.coin_of(tx, args.entry_fee_mist ?? 0n),
            kiosk,
            cap,
          }),
        {
          custody: args.custody,
          gas_scope: `tournament:${args.tournament}`,
        }
      )
    },
    leave_team: (t: string, team: number, character: string) =>
      submit([t], (tx) => sdk.doors.tournament_leave_team(tx, { t, team, character })),
    donate: (t: string, asset: 'sui' | 'kares', amount: bigint, pool?: string | null) =>
      submit([t, ...(pool ? [pool] : [])], (tx) => {
        if (amount <= 0n) throw new Error('Tournament donations must be positive.')
        if (asset === 'sui') sdk.doors.tournament_donate_sui(tx, { t, payment: sdk.coin_of(tx, amount) })
        else if (pool) sdk.doors.tournament_donate_kares(tx, { t, pool, payment: kares_payment(sdk, tx, amount) })
        else sdk.doors.tournament_create_kares_pool(tx, { t, payment: kares_payment(sdk, tx, amount) })
      }),
    open: async (
      args: Readonly<{ tournament: string; index: number; character_id: string; custody?: KioskCustody }>
    ) => {
      const { content_root, seed_package_original } = living_content(sdk, 'Tournament match')
      const catalog = board_catalog_id(content_root, seed_package_original)
      await sdk.hydrate_unknown([args.tournament, catalog])
      return with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.open_tournament_match(tx, { ...args, catalog, kiosk, personal }),
        { custody: args.custody, gas_scope: `tournament:${args.tournament}` }
      )
    },
    join: async (args: Match & Readonly<{ character_id: string; custody?: KioskCustody }>) => {
      await sdk.hydrate_unknown([args.tournament, args.fight])
      return with_kiosk(
        (tx, kiosk, cap) => sdk.doors.join_tournament_match(tx, { ...args, fight_object: args.fight, kiosk, cap }),
        { custody: args.custody, gas_scope: `fight:${args.fight}` }
      )
    },
    ready: async (args: Match & Readonly<{ fighter_indices: readonly bigint[] }>) =>
      project_fight_boundary_receipt(
        await submit([args.tournament, args.fight], (tx) =>
          sdk.doors.ready_tournament_match(tx, { ...args, fight_object: args.fight })
        )
      ),
    crank: async (args: Match) =>
      project_fight_boundary_receipt(
        await submit([args.tournament, args.fight], (tx) =>
          sdk.doors.crank_tournament_match(tx, { ...args, fight_object: args.fight })
        )
      ),
    crank_unopened: (t: string, index: number) =>
      submit([t], (tx) => sdk.doors.tournament_crank_unopened(tx, { t, index })),
    settle: async (args: Match & Seat & Readonly<{ last?: boolean }>) => {
      await sdk.hydrate_unknown([args.tournament, args.fight])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => {
          sdk.doors.settle_tournament_match(tx, { ...args, fight_object: args.fight, kiosk, personal })
          if (args.last) sdk.doors.close_tournament_match(tx, { ...args, fight_object: args.fight })
        },
        { custody: args.custody, gas_scope: `fight:${args.fight}` }
      )
      return Object.freeze({
        digest: receipt_digest(receipt),
        closed: receipt_event(receipt, '::fight::FightClosed') !== null,
      })
    },
    forfeit: async (args: Readonly<{ fight: string }> & Seat) => {
      await sdk.hydrate_unknown([args.fight])
      return project_fight_boundary_receipt(
        await with_terminal_kiosk(
          (tx, kiosk, personal) =>
            sdk.doors.forfeit_tournament_match(tx, { ...args, fight_object: args.fight, kiosk, personal }),
          { custody: args.custody, gas_scope: `fight:${args.fight}` }
        )
      )
    },
    close: async (args: Match) =>
      Object.freeze({
        digest: receipt_digest(
          await submit([args.tournament, args.fight], (tx) =>
            sdk.doors.close_tournament_match(tx, { ...args, fight_object: args.fight })
          )
        ),
      }),
    claim_coins: (t: string, team: number, seat: number, claim: Readonly<{ sui: boolean; pool?: string | null }>) =>
      submit([t, ...(claim.pool ? [claim.pool] : [])], (tx) => {
        if (claim.sui) sdk.doors.tournament_claim_sui(tx, { t, team, seat })
        if (claim.pool) sdk.doors.tournament_claim_kares(tx, { t, pool: claim.pool, team, seat })
      }),
    refund_kares: (t: string, pool: string) =>
      submit([t, pool], (tx) => sdk.doors.tournament_refund_kares(tx, { t, pool })),
    claim_item: async (
      args: Readonly<{
        tournament: string
        team: number
        seat: number
        reward: number
        template: string
        custody?: KioskCustody
      }>
    ) => {
      await sdk.hydrate_unknown([args.tournament, args.template])
      return with_terminal_kiosk(
        (tx, kiosk, personal) => {
          const plan = sdk.doors.prepare_fight_loot(tx, { template: args.template, existing: null })
          sdk.doors.claim_tournament_item(tx, { ...args, plan, kiosk, personal })
        },
        { custody: args.custody, gas_scope: `tournament:${args.tournament}` }
      )
    },
    expire: (t: string, pool?: string | null) =>
      submit([t, ...(pool ? [pool] : [])], (tx) => {
        sdk.doors.tournament_expire(tx, { t })
        if (pool) sdk.doors.tournament_refund_kares(tx, { t, pool })
      }),
  })
}
export type TournamentActions = ReturnType<typeof tournament_actions>

export { TOURNAMENT_MATCH_MS, TOURNAMENT_MAX_TEAMS } from './tournament_rules.gen.ts'
