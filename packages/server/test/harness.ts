// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The server's test door: one fake graph and one fake Redis pair behind the real player harness. Every
// read the account, world and public modules make has a canned answer; a test overrides any of them.

import { EventEmitter } from 'node:events'

import { character_checkpoint, type Claim, type LeaderboardObservation, type ServerPacket } from '@aresrpg/protocol'

import { create_indexing_health } from '../src/indexing_health.ts'
import { create_leaderboards } from '../src/modules/player_leaderboards.ts'
import { create_player as mount_player } from '../src/player.ts'
import type { PlayerSocket } from '../src/player_output.ts'
import { mesh_event_channel } from '../src/protocol.ts'
import { create_public_market } from '../src/public_market.ts'
import { create_public_world } from '../src/public_world.ts'
import { ZERO_TOTALS } from '../src/reads/get_analytics_totals.ts'
import type { Pubsub } from '../src/pubsub_bus.ts'

/** An ordered fixture log: tests read what the server did, in the order it did it. */
const log = <T>() => {
  const entries: T[] = []
  // eslint-disable-next-line fp-law/no-mutating-methods -- a fixture log records effects in order for assertions.
  return Object.freeze({ entries, add: (entry: T): void => void entries.push(entry) })
}

export const make_character = ({
  id = '0xabc',
  x = 100,
  z = 100,
  pet = false,
  dungeon_run = null as string | null,
} = {}) => ({
  properties: {
    id,
    pet,
    name: 'nox',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    experience: '0',
    color_1: 1,
    color_2: 2,
    color_3: 3,
    world: 'overworld',
    checkpoint_world: 'overworld',
    x,
    z,
    at_ms: Date.now() - 60_000,
    spells: '{}',
    ...(dungeon_run ? { dungeon_run } : {}),
  },
})

/** The indexer's fight node: one placement fight whose seat 0 is the first owned character. */
export const fight_node = (machine: Record<string, unknown> = {}, phase = 'placement') => ({
  properties: {
    id: '0xf1',
    world: 'overworld',
    x: 120,
    z: 120,
    phase,
    access_a: 0,
    access_b: 0,
    managed: false,
    wagered: false,
    placement_ms: 0,
    round: phase === 'placement' ? 0 : 1,
    machine: JSON.stringify({
      opener_a: '0xabc',
      opener_b: null,
      queue: [],
      fighters: [
        { team: 0, kind: { player: { character: '0xabc', owner: '0xme', level: 10 } }, hp: 100, settled: false },
      ],
      ...machine,
    }),
  },
})

type TestPubsub = Pubsub & Readonly<{ emitter: EventEmitter }>
type Rows = readonly Record<string, unknown>[]
type Respond = (cypher: string, params?: Record<string, unknown>) => Rows | undefined | Promise<Rows | undefined>
type WireOptions = Readonly<{
  owns?: boolean
  pet?: boolean
  friends?: readonly string[]
  character_ids?: readonly string[]
  /** Another wire's buses: several sockets on one cluster. */
  shared_pubsub?: TestPubsub
  dungeon_run?: string | null
  /** The first character sits seat 0 of this fight before the socket exists. */
  seated?: ReturnType<typeof fight_node>
  fight?: ReturnType<typeof fight_node>
  party?: string | null
  respond?: Respond
}>

const party_row = (id: string) => ({
  party: { properties: { id } },
  members: [{ order: 0, character: { properties: { id: '0xabc', name: 'nox' } } }],
  invited: [],
})

const DEFAULTS = Object.freeze({
  owns: true,
  pet: false,
  friends: [] as readonly string[],
  character_ids: ['0xabc', '0xdef'] as readonly string[],
  dungeon_run: null as string | null,
  party: null as string | null,
})
type Settings = typeof DEFAULTS & WireOptions
/** The second owned character stands one zone east of the first. */
const x_of = ({ character_ids }: Settings, id: string) => (id === character_ids[1] ? 700 : 100)
const PET = { slot: 'pet', item: { properties: { id: '0xpet', item_type: 'bulbiflor' } } }

/** The roster in its two custody shapes: a seated first character leaves the kiosk for its fight. */
const roster_rows = (settings: Settings, at_ms: number) => {
  const { owns, pet, character_ids, dungeon_run, seated } = settings
  const row = (id: string) => ({
    character: { properties: { ...make_character({ pet, id, x: x_of(settings, id), dungeon_run }).properties, at_ms } },
    kiosk_node: { properties: { id: '0xk' } },
    equipment: pet ? [PET] : [],
  })
  const owned = owns ? character_ids : []
  const [first, ...rest] = owned
  if (!seated || !first) return { held: owned.map(row), seated: [], row }
  return { held: rest.map(row), seated: [{ ...row(first), active_fight: { id: '0xf1', seat: 0 } }], row }
}

/** Every canned graph answer, first match wins: the cypher fragment each read is known by. */
const graph_table = (settings: Settings, at_ms: number): readonly (readonly [string, Rows])[] => {
  const roster = roster_rows(settings, at_ms)
  const { party } = settings
  return [
    ['RETURN e.slot AS slot', settings.pet ? [{ slot: 'pet', item_type: 'bulbiflor' }] : []],
    ['-[:MEMBER_OF]->(p:Party)', party ? [party_row(party)] : []],
    ['(p:Party)-[:INVITED]', []],
    ['MATCH (p:Party {id:', [party_row(party ?? '0xp')]],
    [':FRIEND', settings.friends.map((address) => ({ address, characters: [] }))],
    ['[:HOLDS]->(c:Character)', roster.held],
    [':FIGHTER]->(c:Character {owner:', roster.seated],
    ['WHERE c.id IN', [{ character: roster.row('0xabc').character, weapon: null, worn: [] }]],
    [':Fight {id:', [{ fight: settings.fight ?? settings.seated ?? fight_node(), tournament: null }]],
    ['MATCH (c:Character {dungeon:', [{ character_id: '0xabc', name: 'nox', level: 10, room: 1 }]],
    [':Fight', []],
    [
      ':Zone',
      [{ zone: { properties: { world: 'overworld', zx: 0, zz: 0, seed: '7', mob_taken: '0', res_taken: [] } } }],
    ],
    ['WHERE c.owner IS NOT NULL', [{ character_id: '0xabc', name: 'nox', owner: '0xowner' }]],
    ['HOLDS_VOUCHER', [{ giftcard: { properties: { id: '0xgift', template: '0xtemplate', amount: 1 } } }]],
  ]
}

export const wire = (options: WireOptions = {}) => {
  const at_ms = Date.now() - 60_000
  const settings = { ...DEFAULTS, ...options } as Settings
  const table = graph_table(settings, at_ms)
  const sent = log<ServerPacket>()
  const dropped = log<string>()
  const published = log<{ channel: string; payload: any }>()
  const reads = log<{ query: string; params?: Record<string, unknown> }>()
  const leaderboard_readers = log<string>()
  const ws = {
    send: (raw: string) => sent.add(JSON.parse(raw)),
    close: (_code?: number, reason?: string) => dropped.add(reason ?? ''),
  }
  const graph = {
    read: async (query: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
      reads.add({ query, params })
      const custom = await options.respond?.(query, params)
      return [...(custom ?? table.find(([fragment]) => query.includes(fragment))?.[1] ?? [])]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  const emit = emitter.emit.bind(emitter)
  emitter.emit = (channel, ...args) =>
    emit(typeof channel === 'string' ? mesh_event_channel(channel, args[0]) : channel, ...args)
  const bus = {
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      published.add({ channel, payload })
      emitter.emit(channel, payload)
    },
    close: () => {},
  }
  const own_pubsub = {
    emitter,
    graph: {
      ...bus,
      indexed_checkpoint: async () => 1,
      indexed_state: async () => ({ sequence_number: 1, epoch: '9' }),
      sales_history: async () => [] as string[],
      leaderboard: async (observation: LeaderboardObservation) => ({
        observation,
        reset_at_ms: 2,
        timestamp_ms: 1,
        checkpoint: 1,
        entries: [],
        self: null,
      }),
      leaderboard_rank: async (_metric: string, address: string) => {
        leaderboard_readers.add(address)
        return null
      },
      market_prices: async () => ({ history: null, total_units: '0' }),
      market_volume: async () => ({ day_mist: '7', month_mist: '9', history_days: 1 }),
      market_changes: async () => ({}),
      analytics_hashes: async (keys: readonly string[]) => keys.map(() => ({})),
      analytics_sets: async (keys: readonly string[]) => keys.map(() => []),
      analytics_counts: async (keys: readonly string[]) => keys.map(() => 0),
      analytics_totals: async (keys: readonly string[]) => keys.map(() => ZERO_TOTALS),
      analytics_cumulative_counts: async (_key: string, maxes: readonly number[]) => [...maxes.map(() => 0), 0],
    },
    mesh: {
      ...bus,
      heartbeat: async () => {},
      cluster_online: async () => ({ online: 7, online_characters: 12 }),
      record_online: async () => {},
      online_samples: async (keys: readonly string[]) => keys.map(() => []),
    },
  }
  const pubsub: TestPubsub = options.shared_pubsub ?? own_pubsub
  const checkpoint = (id: string) =>
    character_checkpoint({ world: 'overworld', checkpoint_world: 'overworld', x: x_of(settings, id), z: 100, at_ms })!
  return {
    sent: sent.entries,
    dropped: dropped.entries,
    published: published.entries,
    reads: reads.entries,
    leaderboard_readers: leaderboard_readers.entries,
    ws,
    graph,
    pubsub,
    checkpoint,
  }
}
export type Wire = ReturnType<typeof wire>

type Wires = Parameters<typeof mount_player>[0]
type Holder = Readonly<{ claim: Claim; address?: never }> | Readonly<{ address: string; claim?: never }>
type TestWires = Pick<Wire, 'graph' | 'pubsub'> &
  Readonly<{ ws: PlayerSocket }> &
  Partial<Omit<Wires, 'claim' | 'ws' | 'graph' | 'pubsub'>> &
  Holder

/** Mount one socket on the real harness: `address` names the game seat of that address. */
export const create_player = ({ address, claim, ...wires }: TestWires) =>
  mount_player({
    admin: false,
    public_world: create_public_world(wires.graph, wires.pubsub.graph),
    public_market: create_public_market(wires.graph, wires.pubsub.graph),
    leaderboards: create_leaderboards(wires),
    game_state: { get: () => false, listen: () => () => {}, start: async () => {} },
    indexing_health: create_indexing_health({
      chain_checkpoint: async () => ({ sequence_number: 43, timestamp_ms: 1_000_000 }),
      indexed_state: wires.pubsub.graph.indexed_state,
    }),
    ...wires,
    claim: claim ?? { stage: 'seated', address: address! },
  })

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
export const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round++) await flush()
}
export const types_of = (packets: readonly { type: string }[]) => packets.map(({ type }) => type)
