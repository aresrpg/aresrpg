// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The account a socket proved, as one table. Every row subscribes before its first read, re-reads
// (coalesced) on its own events and sends one packet. `packet/characters` is the ready barrier: it is
// held until every snapshot row has read once, and a snapshot read that fails before then drops the
// socket; reconnection owns recovery. A stream row only logs its failures. Each owned character's
// chain channel stays armed: its events re-read the roster and resolutions, or carry a party, seat
// or invite fact that the seat's modules fold.

import type { MarketSaleRow, ServerPacket } from '@aresrpg/protocol'

import { coalesced_reader } from '../latest_read.ts'
import { create_inventory_reader } from '../inventory_reader.ts'
import logger from '../logger.ts'
import { reaches, type PlayerAction, type PlayerContext, type PlayerModule, type PlayerState } from '../player.ts'
import { channels, type EventEnvelope } from '../protocol.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { get_characters } from '../reads/get_characters.ts'
import { get_closable_fights } from '../reads/get_closable_fights.ts'
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { get_friends } from '../reads/get_friends.ts'
import { get_kolizeums } from '../reads/get_kolizeums.ts'
import { get_market_history } from '../reads/get_market_history.ts'
import { get_mastery } from '../reads/get_mastery.ts'
import { get_tournaments } from '../reads/get_tournaments.ts'
import { get_trades } from '../reads/get_trades.ts'
import { get_claims, get_giftcards, get_my_listings } from '../reads/get_user_economy.ts'

const log = logger(import.meta)

type Role = 'barrier' | 'snapshot' | 'stream'
/** A `MarketPurchased` event as the indexer publishes it. */
type IndexedSale = Omit<MarketSaleRow, 'id' | 'counterparty' | 'ts_ms'> & Readonly<{ buyer: string }>
type Row = Readonly<{
  from: 'signed' | 'seated'
  role: Role
  read: () => Promise<ServerPacket>
  /** What this socket folds from the packet, at once, even while the barrier holds it. */
  fold?: (packet: never) => void
  /** The channel whose events may change the row; the test may forward what the event itself carries. */
  on?: readonly [channel: string, changes: (event: EventEnvelope) => boolean]
}>
const row = <P extends ServerPacket>(
  spec: Readonly<Omit<Row, 'read' | 'fold'>> & {
    read: () => Promise<P>
    fold?: (packet: P) => void
  }
): Row => spec as Row

const rows_of = ({ graph, pubsub, address, signal, send, dispatch }: PlayerContext) => {
  const social = channels.social(address)
  const inventory = create_inventory_reader({ graph, pubsub, address, signal, send })
  const sold_by_me = ({ type, data }: EventEnvelope) => type === 'MarketPurchased' && data.seller === address
  return {
    characters: row({
      from: 'signed',
      role: 'barrier',
      read: async () => ({ type: 'packet/characters', characters: await get_characters(graph, { address }) }),
      fold: ({ characters }) => dispatch({ type: 'action/character_roster', characters }),
      on: [social, ({ type }) => type === 'CharacterCreated' || type === 'CharacterHeld'],
    }),
    inventory: row({
      from: 'signed',
      role: 'snapshot',
      read: async () => ({ type: 'packet/inventory', items: await inventory.read() }),
    }),
    giftcards: row({
      from: 'signed',
      role: 'snapshot',
      read: async () => ({ type: 'packet/giftcards', giftcards: await get_giftcards(graph, { address }) }),
      on: [social, ({ type }) => type === 'GiftcardsChanged'],
    }),
    listings: row({
      from: 'signed',
      role: 'snapshot',
      read: async () => ({ type: 'packet/listings', ...(await get_my_listings(graph, { address })) }),
      on: [
        channels.economy,
        ({ type, data }) =>
          data.seller === address && ['MarketListed', 'MarketDelisted', 'MarketPurchased'].includes(type),
      ],
    }),
    mastery: row({
      from: 'signed',
      role: 'snapshot',
      read: async () => ({ type: 'packet/mastery', ...(await get_mastery(graph, { address })) }),
    }),
    history: row({
      from: 'signed',
      role: 'stream',
      read: async () => ({
        type: 'packet/market_history',
        ...(await get_market_history(graph, pubsub.graph, { address })),
      }),
      // A sale of my listing is money arriving: it always reaches me, before the history re-read.
      on: [
        channels.economy,
        (event) => {
          if (!sold_by_me(event)) return false
          const { object, buyer, kind, name, item_type, amount, price_mist } = event.data as IndexedSale
          const id = `${event.ckpt}:${event.tx}:${event.evt}`
          const sale = {
            id,
            object,
            kind,
            name,
            item_type,
            amount,
            price_mist,
            counterparty: buyer,
            ts_ms: event.ts_ms,
          }
          send({ type: 'packet/listing_sold', sale })
          return true
        },
      ],
    }),
    claims: row({
      from: 'seated',
      role: 'snapshot',
      read: async () => ({ type: 'packet/claims', claims: await get_claims(graph, { address }) }),
      on: [
        channels.economy,
        ({ type, data }) =>
          (type === 'GearCrushed' ? data.crusher : data.opener) === address &&
          ['LootBoxOpened', 'LootClaimed', 'GearCrushed'].includes(type),
      ],
    }),
    resolutions: row({
      from: 'seated',
      role: 'snapshot',
      read: async () => ({
        type: 'packet/fight_resolutions',
        resolutions: await get_fight_resolutions(graph, { address }),
      }),
    }),
    closable_fights: row({
      from: 'seated',
      role: 'snapshot',
      read: async () => ({ type: 'packet/closable_fights', fights: await get_closable_fights(graph, { address }) }),
    }),
    trades: row({
      from: 'seated',
      role: 'stream',
      read: async () => ({ type: 'packet/trades', trades: await get_trades(graph, { address }) }),
      on: [
        social,
        ({ type, data }) => {
          if (type === 'TradeDestroyed' && typeof data.trade === 'string')
            send({ type: 'packet/trade_destroyed', trade: data.trade })
          return type === 'TradeChanged' || type === 'TradeDestroyed'
        },
      ],
    }),
    friends: row({
      from: 'seated',
      role: 'stream',
      read: async () => ({ type: 'packet/friends', friends: await get_friends(graph, { address }) }),
      fold: ({ friends }) =>
        dispatch({ type: 'action/friends', friends: friends.map((friend) => String(friend.address)) }),
      on: [social, ({ type }) => type === 'FriendListChanged'],
    }),
    kolizeums: row({
      from: 'seated',
      role: 'stream',
      read: async () => ({ type: 'packet/kolizeums', lobbies: await get_kolizeums(graph, { address }) }),
      on: [channels.kolizeum, () => true],
    }),
    tournaments: row({
      from: 'seated',
      role: 'stream',
      read: async (): Promise<ServerPacket> => {
        try {
          return { type: 'packet/tournaments', tournaments: await get_tournaments(graph, address) }
        } catch (error) {
          log.error({ err: error }, 'tournament read failed')
          return { type: 'packet/tournaments_error', reason: 'unavailable' }
        }
      },
      on: [channels.tournament, () => true],
    }),
  } satisfies Record<string, Row>
}
export type AccountDomain = keyof ReturnType<typeof rows_of>

/** Before the barrier lifts: the snapshot rows still unread and the held roster packet. */
type Baseline =
  Readonly<{ ready: false; waiting: ReadonlySet<AccountDomain>; held: ServerPacket | null }> | Readonly<{ ready: true }>
type BaselineInput = Readonly<{ key: AccountDomain }> &
  (Readonly<{ kind: 'requested' }> | Readonly<{ kind: 'landed'; barrier: boolean; packet: ServerPacket }>)

/** The one writer of the baseline, for snapshot rows: what it becomes, and the packets that leave now. */
const baseline_step = (
  baseline: Baseline,
  input: BaselineInput
): Readonly<{ baseline: Baseline; out: readonly ServerPacket[] }> => {
  if (baseline.ready) return { baseline, out: input.kind === 'landed' ? [input.packet] : [] }
  const waiting = new Set(baseline.waiting)
  if (input.kind === 'requested') return { baseline: { ...baseline, waiting: waiting.add(input.key) }, out: [] }
  waiting.delete(input.key)
  const [held, out] = input.barrier ? [input.packet, []] : [baseline.held, [input.packet]]
  if (waiting.size) return { baseline: { ready: false, waiting, held }, out }
  return { baseline: { ready: true }, out: held ? [...out, held] : out }
}

const ROSTER_EVENTS = new Set([
  'WorldJoined',
  'CharacterChanged',
  'DungeonEntered',
  'DungeonRoomCleared',
  'DungeonEnded',
  'CharacterTeleported',
  'CharacterDeleted',
  'CharacterSeated',
  'CharacterHeld',
])
const RESOLUTION_EVENTS = new Set(['FightResolutionChanged', 'CharacterHeld'])
/** What a character channel event says to the seat. A seat is custody: the seated character arms the
 *  same fight door as a joiner, and its release re-locks it into the kiosk. */
const CHARACTER_ACTIONS: Readonly<
  Record<string, (character_id: string, data: Readonly<Record<string, unknown>>) => PlayerAction>
> = {
  PartyInvitesChanged: (character_id) => ({ type: 'action/party_invites_changed', character_id }),
  PartyJoined: (_, data) => ({ type: 'action/party', character_id: String(data.character), party: String(data.party) }),
  PartyLeft: (_, data) => ({ type: 'action/party', character_id: String(data.character), party: null }),
  CharacterSeated: (_, data) => ({
    type: 'action/fight',
    character_id: String(data.character),
    fight: String(data.fight),
    seat: Number(data.seat),
  }),
  CharacterHeld: (_, data) => ({ type: 'action/fight', character_id: String(data.character), fight: null }),
}

/** A character's chain channel: its facts re-enter as actions, and the roster and resolutions re-read. */
const character_forward =
  (dispatch: PlayerContext['dispatch'], refresh: (key: AccountDomain) => void, character_id: string) =>
  ({ type, data }: EventEnvelope): void => {
    const action = CHARACTER_ACTIONS[type]?.(character_id, data)
    if (action) dispatch(action)
    if (ROSTER_EVENTS.has(type)) refresh('characters')
    if (RESOLUTION_EVENTS.has(type)) refresh('resolutions')
  }

const observe = (context: PlayerContext): void => {
  const { address, stage, events, signal, drop, pubsub, dispatch } = context
  const mounted = Object.entries(rows_of(context)).filter(([, { from }]) => reaches(from, stage)) as [
    AccountDomain,
    Row,
  ][]
  let baseline: Baseline = {
    ready: false,
    waiting: new Set(mounted.flatMap(([key, { role }]) => (role === 'stream' ? [] : [key]))),
    held: null,
  }
  const step = (input: BaselineInput): void => {
    const { baseline: next, out } = baseline_step(baseline, input)
    baseline = next
    out.forEach(context.send)
  }
  const reader = (key: AccountDomain, { role, read, fold }: Row) => {
    const latest = coalesced_reader(
      read,
      (packet) => {
        fold?.(packet as never)
        if (role === 'stream') context.send(packet)
        else step({ kind: 'landed', key, barrier: role === 'barrier', packet })
      },
      signal
    )
    let observed: Promise<void> | null = null
    return (): void => {
      if (signal.aborted) return
      if (role !== 'stream') step({ kind: 'requested', key })
      const pending = latest()
      if (pending === observed) return
      observed = pending
      void pending.catch((error: Error) => {
        if (signal.aborted) return
        log.error({ address, domain: key, error: error.message }, 'account read failed')
        if (role !== 'stream' && !baseline.ready) drop('SNAPSHOT_FAILED')
      })
    }
  }
  const readers = new Map(mounted.map(([key, spec]) => [key, reader(key, spec)]))
  const refresh = (key: AccountDomain): void => readers.get(key)?.()
  events.on('action/refresh_account', ({ domain }: Extract<PlayerAction, { type: 'action/refresh_account' }>) =>
    refresh(domain)
  )

  const { watch, unwatch } = create_watcher(pubsub, signal)
  const followed = [...new Set(mounted.flatMap(([, { on }]) => (on ? [on[0]] : [])))]
  const forward = (channel: string) => (event: EventEnvelope) =>
    mounted.forEach(([key, { on }]) => {
      if (on?.[0] === channel && on[1](event)) refresh(key)
    })
  void Promise.all(followed.map((channel) => watch(channel, forward(channel))))
    .then(() => readers.forEach((read) => read()))
    .catch((error: Error) => {
      log.error({ address, error: error.message }, 'account subscription failed')
      if (!signal.aborted) drop('SNAPSHOT_FAILED')
    })

  events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
    if (state.roster === previous.roster) return
    Object.keys(previous.roster).forEach((id) => {
      if (!state.roster[id]) unwatch(channels.character(id))
    })
    Object.keys(state.roster).forEach((character_id) => {
      if (previous.roster[character_id]) return
      void watch(channels.character(character_id), character_forward(dispatch, refresh, character_id))
        .then(() => {
          if (signal.aborted) return
          refresh('characters')
          refresh('resolutions')
          dispatch({ type: 'action/character_watch_ready', character_id })
        })
        .catch((error: Error) => log.error({ character_id, error: error.message }, 'character watch failed'))
    })
  })
}

export default {
  name: 'account_streams',
  reduce: (state, action) => {
    if (action.type === 'action/character_roster')
      return { ...state, roster: Object.freeze(Object.fromEntries(action.characters.map((row) => [row.id, row]))) }
    if (action.type === 'action/friends') return { ...state, friends: new Set(action.friends) }
    return state
  },
  observe,
} satisfies PlayerModule
