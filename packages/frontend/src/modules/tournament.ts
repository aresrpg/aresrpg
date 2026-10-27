// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { TournamentSettings } from '@aresrpg/sdk/tournament-admin'
import { tournament_coin_claims, type TournamentLink, type TournamentRow, type ServerPacket } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import type { AuthSession } from '@aresrpg/sdk/auth'
import { pre_submission_failure, readable_transaction_error } from '@aresrpg/sdk/transaction-error'

import { sui_session } from '../wallet/external_session.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { env } from '../env.ts'
import { toast } from '../toast.ts'
import { error_message } from '../i18n/error_text.ts'
import { tournament_path } from '../tournament/navigation.ts'

import { character_custody } from './session.ts'
import { chain_now } from './chain_clock.ts'
import { create_claim_attempts } from './giftcard_attempts.ts'
import {
  collected_tournament_rewards,
  pending_tournament_presentation,
  type TournamentCollection,
} from './tournament_rewards.ts'

export type TournamentState = Readonly<{
  rows: readonly TournamentRow[]
  links: Readonly<Record<string, TournamentLink>>
  pending: string | null
  feed_status: 'loading' | 'loaded' | 'unavailable'
  entry_failures: Readonly<Record<string, TournamentEntryFailure>>
  outcome: Readonly<{ key: string; reason: string | null }> | null
  pending_podium: string | null
  collections: readonly TournamentCollection[]
  reward_reveal: readonly string[]
}>
export type TournamentEntryFailure = Readonly<{
  id: string
  index: number
  character: string
  version: string
  reason: string
}>
export type TournamentAction =
  | Readonly<{ kind: 'create'; name: string; allowed: readonly string[]; character: string }>
  | Readonly<{ kind: 'join'; team: number; revision: string; character: string }>
  | Readonly<{ kind: 'find'; character: string }>
  | Readonly<{ kind: 'leave'; team: number; character: string }>
  | Readonly<{ kind: 'enter'; index: number; character: string }>
  | Readonly<{ kind: 'crank'; index: number }>
  | Readonly<{ kind: 'donate'; asset: 'sui' | 'kares'; amount: bigint }>
  | Readonly<{ kind: 'coins'; team: number; seat: number }>
  | Readonly<{ kind: 'item'; team: number; seat: number; reward: number }>
  | Readonly<{ kind: 'expire' }>
  | Readonly<{ kind: 'refund' }>
export type TournamentAdminAction =
  | Readonly<{ kind: 'create'; settings: TournamentSettings }>
  | Readonly<{ kind: 'start' | 'cancel'; id: string; admin: string }>
  | Readonly<{ kind: 'display' }>
export type TournamentInput =
  | Readonly<{ type: 'tournament/admin'; action: TournamentAdminAction }>
  | Readonly<{ type: 'tournament/action'; id: string; action: TournamentAction }>
  | Readonly<{ type: 'tournament/pending'; key: string | null }>
  | Readonly<{
      type: 'tournament/outcome'
      key: string
      reason: string | null
      collection?: TournamentCollection | null
    }>
  | Readonly<{ type: 'tournament/podium_opened'; id: string }>
  | Readonly<{ type: 'tournament/rewards_opened' }>
  | Readonly<{ type: 'tournament/rewards_closed' }>
  | Readonly<{
      type: 'tournament/entry_result'
      key: string
      entry: Omit<TournamentEntryFailure, 'reason'>
      reason: string | null
    }>
export const initial_tournament_state = (): TournamentState => ({
  rows: [],
  links: {},
  pending: null,
  feed_status: 'loading',
  entry_failures: {},
  outcome: null,
  pending_podium: null,
  collections: [],
  reward_reveal: [],
})
export const tournament_for_fight = (state: AppState, fight: string): TournamentLink | null =>
  state.tournament.links[fight] ?? null
export const tournament_opened_elsewhere = (error: unknown): boolean =>
  pre_submission_failure(error) &&
  /abort code:\s*3204\b[^]*?::tournament::link_fight/.test(readable_transaction_error(error))

export const action_key = (t: TournamentRow, action: TournamentAction): string =>
  `${t.id}:${action.kind}:${'index' in action ? action.index : ''}:${'character' in action ? action.character : ''}:${'team' in action ? action.team : ''}:${'seat' in action ? action.seat : ''}:${'reward' in action ? action.reward : ''}${action.kind === 'enter' ? `:${t.matches[action.index].fight ?? 'opening'}` : ''}`

const entry_current = (
  rows: readonly TournamentRow[],
  key: string,
  entry: Omit<TournamentEntryFailure, 'reason'>
): boolean => {
  const t = rows.find((row) => row.id === entry.id)
  const match = t?.matches[entry.index]
  if (!t || !match) return false
  return [
    t.status === 'in_progress',
    t.version === entry.version,
    match.state === 1,
    !['active', 'ended'].includes(match.phase ?? ''),
    !match.joined?.includes(entry.character),
    action_key(t, { kind: 'enter', index: entry.index, character: entry.character }) === key,
  ].every(Boolean)
}

const entry_result = (
  state: AppState,
  input: Extract<TournamentInput, { type: 'tournament/entry_result' }>
): AppState => {
  const { entry, key, reason } = input
  if (!entry_current(state.tournament.rows, key, entry)) return state
  const failures = Object.fromEntries(
    Object.entries(state.tournament.entry_failures).filter(([stored]) => stored !== key)
  )
  const entry_failures = reason === null ? failures : { ...failures, [key]: { ...entry, reason } }
  return { ...state, tournament: { ...state.tournament, entry_failures } }
}

const FEED_STATUS: Readonly<Partial<Record<AppInput['type'], TournamentState['feed_status']>>> = {
  'link/connecting': 'loading',
  'link/failed': 'unavailable',
  'link/rejected': 'unavailable',
  'link/replaced': 'unavailable',
}

type TournamentUpdate = Extract<
  AppInput,
  {
    type:
      | 'auth/disconnected'
      | 'auth/rejected'
      | 'tournament/pending'
      | 'tournament/outcome'
      | 'tournament/podium_opened'
      | 'tournament/rewards_opened'
      | 'tournament/rewards_closed'
  }
>
const UPDATES: {
  readonly [Kind in TournamentUpdate['type']]: (
    state: TournamentState,
    input: Extract<TournamentUpdate, { type: Kind }>
  ) => TournamentState
} = {
  'auth/disconnected': initial_tournament_state,
  'auth/rejected': initial_tournament_state,
  'tournament/pending': (state, input) => ({ ...state, pending: input.key, outcome: input.key ? null : state.outcome }),
  'tournament/outcome': (state, input) => {
    if (state.pending !== input.key) return state
    const collection = input.reason === null ? input.collection : null
    const fresh = collection && !state.collections.some((row) => row.digest === collection.digest)
    return {
      ...state,
      outcome: { key: input.key, reason: input.reason },
      collections: fresh ? [...state.collections, collection] : state.collections,
    }
  },
  'tournament/podium_opened': (state, input) =>
    state.pending_podium === input.id ? { ...state, pending_podium: null } : state,
  'tournament/rewards_opened': (state) =>
    state.reward_reveal.length
      ? state
      : {
          ...state,
          reward_reveal: state.collections.filter((row) => !row.acknowledged).map((row) => row.digest),
        },
  'tournament/rewards_closed': (state) => ({
    ...state,
    collections: state.collections.map((row) =>
      state.reward_reveal.includes(row.digest) ? { ...row, acknowledged: true } : row
    ),
    reward_reveal: [],
  }),
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const update = UPDATES[input.type as TournamentUpdate['type']]
  if (update) {
    // The same discriminant selects the state transform and its input payload.
    const tournament = update(state.tournament, input as never)
    return tournament === state.tournament ? state : { ...state, tournament }
  }
  if (input.type === 'tournament/entry_result') return entry_result(state, input)
  const feed_status = FEED_STATUS[input.type]
  if (feed_status) return { ...state, tournament: { ...state.tournament, feed_status } }
  return input.type === 'server/packet' ? fold_packet(state, input.packet) : state
}

const fold_packet = (state: AppState, packet: Readonly<ServerPacket>): AppState => {
  if (packet.type === 'packet/tournaments_error')
    return { ...state, tournament: { ...state.tournament, feed_status: 'unavailable' } }
  if (packet.type === 'packet/fight_state' && packet.state.tournament)
    return {
      ...state,
      tournament: {
        ...state.tournament,
        links: { ...state.tournament.links, [packet.fight]: packet.state.tournament },
      },
    }
  if (packet.type !== 'packet/tournaments') return state
  const previous = new Map(state.tournament.rows.map((row) => [row.id, row]))
  const rows = packet.tournaments.map((row) => {
    const old = previous.get(row.id)
    return old && (BigInt(old.version) > BigInt(row.version) || BigInt(old.token_version) > BigInt(row.token_version))
      ? old
      : row
  })
  const finished = rows.find(
    (row) =>
      row.status === 'finished' &&
      previous.get(row.id)?.status === 'in_progress' &&
      row.teams.some((team) => team.seats.some((seat) => seat.owner === state.session.wallet?.address))
  )
  const links = Object.fromEntries(
    rows.flatMap((row) =>
      row.matches.flatMap((match, index) => (match.fight ? [[match.fight, { id: row.id, index }] as const] : []))
    )
  )
  const entry_failures = Object.fromEntries(
    Object.entries(state.tournament.entry_failures).filter(([key, entry]) => entry_current(rows, key, entry))
  )
  return {
    ...state,
    tournament: {
      ...state.tournament,
      rows,
      pending_podium: finished?.id ?? state.tournament.pending_podium,
      feed_status: 'loaded',
      entry_failures,
      links: { ...state.tournament.links, ...links },
    },
  }
}

export const open_team = (t: TournamentRow, character: string, address: string): number => {
  const own = t.teams.findIndex((team) => team.seats.some((seat) => seat.owner === address))
  if (own >= 0) return t.teams[own].seats.length < t.format ? own : -1
  return (
    t.teams
      .map((team, index) => ({ team, index }))
      .filter(
        ({ team }) => team.seats.length < t.format && (team.allowed.length === 0 || team.allowed.includes(character))
      )
      .toSorted((a, b) => b.team.seats.length - a.team.seats.length || a.index - b.index)[0]?.index ?? -1
  )
}

const execute = (
  state: AppState,
  wallet: AuthSession,
  t: TournamentRow,
  action: TournamentAction
): Promise<unknown> => {
  const character =
    'character' in action ? state.session.characters.find(({ id }) => id === action.character) : undefined
  const custody = character ? character_custody(character) : undefined
  const sdk = wallet.tournament
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
      }),
    join: (input) =>
      sdk.join_team({
        tournament: t.id,
        team: input.team,
        revision: input.revision,
        character_id: input.character,
        custody,
      }),
    find: (input) => {
      const team = open_team(t, input.character, wallet.address)
      return team >= 0
        ? sdk.join_team({
            tournament: t.id,
            team,
            revision: t.teams[team].revision,
            character_id: input.character,
            custody,
          })
        : sdk.create_team({
            tournament: t.id,
            name: character?.name ?? input.character,
            allowed: [],
            character_id: input.character,
            custody,
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
    expire: () => sdk.expire(t.id, t.kares_pool),
    refund: () => (t.kares_pool ? sdk.refund_kares(t.id, t.kares_pool) : Promise.resolve()),
  }
  // The key and payload come from the same discriminated input; each table entry is checked above.
  return (handlers[action.kind] as (input: TournamentAction) => Promise<unknown>)(action)
}

export const tournament_claims = (t: TournamentRow, address: string | null): readonly TournamentAction[] => {
  if (t.status !== 'finished') return []
  return t.teams.flatMap((team, team_index) =>
    team.seats.flatMap((seat, seat_index) => {
      if (team.place === 0 || seat.owner !== address) return []
      const { sui, kares } = tournament_coin_claims(t, team_index, seat_index)
      const coins: TournamentAction[] =
        sui > 0n || kares > 0n ? [{ kind: 'coins', team: team_index, seat: seat_index }] : []
      const items = t.rewards.flatMap((reward, index): TournamentAction[] =>
        reward.place === team.place && (BigInt(seat.items_claimed) & (1n << BigInt(index))) === 0n
          ? [{ kind: 'item', team: team_index, seat: seat_index, reward: index }]
          : []
      )
      return [...coins, ...items]
    })
  )
}

export const automatic_actions = (
  state: AppState,
  now: number
): readonly Readonly<{ id: string; action: TournamentAction }>[] => {
  const address = state.session.wallet?.address
  if (!address) return []
  return state.tournament.rows.flatMap((t) => {
    if (t.status === 'finished') return tournament_claims(t, address).map((action) => ({ id: t.id, action }))
    if (t.status !== 'in_progress') return []
    return t.matches.flatMap((match, index) => {
      if (match.state !== 1) return []
      const owned = [match.a, match.b].flatMap((team) =>
        team === null ? [] : t.teams[team].seats.filter((seat) => seat.owner === address)
      )
      if (!owned.length) return []
      if (match.phase === 'ended') return [{ id: t.id, action: { kind: 'crank', index } as TournamentAction }]
      if (now >= match.available_ms + Number(CONTRACT_CONSTANTS.placement_force_ms)) return []
      const entries = owned.flatMap((seat) => {
        const character = state.session.characters.find(({ id }) => id === seat.character)
        return character?.custody === 'kiosk' && !match.joined?.includes(seat.character)
          ? [{ id: t.id, action: { kind: 'enter', index, character: seat.character } as TournamentAction }]
          : []
      })
      return match.fight ? entries : entries.slice(0, 1)
    })
  })
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch, signal }) => {
  const attempts = create_claim_attempts(browser_auth_storage(), env.network, 'tournament')
  let active = false
  const run = (id: string, action: TournamentAction, automatic = false): void => {
    const state = get_state()
    const { wallet } = state.session
    const t = state.tournament.rows.find((row) => row.id === id)
    if (active || !wallet || !t) return
    active = true
    const key = action_key(t, action)
    attempts.remember(wallet.address, key)
    dispatch({ type: 'tournament/pending', key })
    const finished = (reason: string | null, collection?: TournamentCollection | null): void => {
      if (!signal.aborted && get_state().session.wallet === wallet)
        dispatch({ type: 'tournament/outcome', key, reason, collection })
    }
    const entry_finished = (reason: string | null): void => {
      if (action.kind !== 'enter' || signal.aborted || get_state().session.wallet !== wallet) return
      dispatch({
        type: 'tournament/entry_result',
        key,
        reason,
        entry: { id, index: action.index, character: action.character, version: t.version },
      })
    }
    void Promise.resolve()
      .then(() => execute(state, wallet, t, action))
      .then((result) => {
        entry_finished(null)
        finished(null, collected_tournament_rewards(t, action, result, wallet.address))
      })
      .catch((error: unknown) => {
        if (action.kind === 'enter' && tournament_opened_elsewhere(error)) {
          entry_finished(null)
          finished(null)
          return
        }
        finished(error_message(error))
        if (automatic) entry_finished(error_message(error))
        toast.add(error)
      })
      .finally(() => {
        active = false
        if (!signal.aborted && get_state().session.wallet === wallet)
          dispatch({ type: 'tournament/pending', key: null })
      })
  }
  events.on('tournament/admin', ({ action }) => {
    const session = sui_session(get_state().external_wallet.session)
    if (active || !session) return
    active = true
    dispatch({ type: 'tournament/pending', key: 'admin' })
    void import('@aresrpg/sdk/admin-auth')
      .then(({ as_admin_session }) => {
        const sdk = as_admin_session(session).tournaments
        if (action.kind === 'display') return sdk.setup_display()
        if (action.kind === 'create') return sdk.create(action.settings)
        return action.kind === 'start'
          ? sdk.start(action.id, action.admin)
          : sdk.cancel(
              action.id,
              action.admin,
              get_state().tournament.rows.find(({ id }) => id === action.id)?.kares_pool
            )
      })
      .then(() => {
        if (!signal.aborted && get_state().external_wallet.session === session)
          dispatch({ type: 'tournament/outcome', key: 'admin', reason: null })
      })
      .catch((error: unknown) => {
        if (!signal.aborted && get_state().external_wallet.session === session)
          dispatch({ type: 'tournament/outcome', key: 'admin', reason: error_message(error) })
        toast.add(error)
      })
      .finally(() => {
        active = false
        if (!signal.aborted) dispatch({ type: 'tournament/pending', key: null })
      })
  })
  events.on('tournament/action', ({ id, action }) => run(id, action))
  events.on('tournament/podium_opened', ({ id }) =>
    dispatch({ type: 'path/open', pathname: tournament_path(id, 'podium') })
  )
  events.on('STATE_UPDATED', (state) => {
    const now = chain_now(state.chain_clock, performance.now())
    const address = state.session.wallet?.address ?? ''
    const can_write = [
      !active,
      state.session.link_status === 'ready',
      state.tournament.feed_status === 'loaded',
      state.session.wallet !== null,
      now !== null,
    ].every(Boolean)
    const next = can_write
      ? automatic_actions(state, now!)
          .map(({ id, action }) => ({ t: state.tournament.rows.find((row) => row.id === id)!, action }))
          .find(({ t, action }) => !attempts.has(address, action_key(t, action)))
      : undefined
    if (next && attempts.remember(address, action_key(next.t, next.action))) run(next.t.id, next.action, true)
    if (!next) {
      const presentation = pending_tournament_presentation(state)
      if (presentation) dispatch(presentation)
    }
  })
}
export default { name: 'tournament', reduce, observe } satisfies AppModule
