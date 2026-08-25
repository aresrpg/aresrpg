// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The new stream surfaces: chat (mesh + flood gate), the fight watch (armed by the chain,
// disarmed by the chain), market observation (state-fold → push), the self stream's party
// invite, and the cluster heartbeat packet.

import { EventEmitter } from 'node:events'

import { describe, expect, test } from 'bun:test'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_player } from '../src/player.ts'

const character = {
  properties: {
    id: '0xabc',
    name: 'nox',
    classe: 'senshi',
    sex: 'male',
    level: 10,
    color_1: 1,
    color_2: 2,
    color_3: 3,
    world: 'overworld',
    x: 100,
    z: 100,
    spells: '{}',
    spell_points_spent: 0,
  },
}

const fight_node = {
  properties: {
    id: '0xf1',
    world: 'overworld',
    x: 120,
    z: 120,
    phase: 'placement',
    access_a: 0,
    access_b: 0,
    managed: false,
    wagered: false,
    winner: null,
    dungeon_room: null,
    drops_rolled: false,
    turn_ptr: 0,
    round: 0,
    turn_seed: '0',
    placement_ms: 0,
    turn_started_ms: 0,
    // the indexer's machine document (graph.rs fight_machine) — the replayable blob
    machine: JSON.stringify({
      board: {
        width: 8,
        height: 8,
        shape_mask: ['0'],
        obstacles: [],
        holes: [],
        start_cells_a: [1],
        start_cells_b: [62],
      },
      closed: [],
      opener_a: '0xabc',
      opener_b: null,
      queue: [],
      turn_slot: 0,
      turn_casts: [],
      zones: [],
      fighters: [
        {
          team: 0,
          kind: { player: { character: '0xabc', owner: '0xme', level: 10 } },
          cell: 1,
          ready: false,
          dead: false,
          settled: false,
          forfeited: false,
          hp: 100,
          ap: 6,
          mp: 3,
          drops: [],
          effects: [],
          cooldowns: [],
        },
      ],
    }),
  },
}

/** `seated` puts the character in a fight BEFORE the connection exists — the custody the
 *  embody read must find (a reconnect mid-fight, or the creator seated at the fight's birth). */
const wire = ({ seated = false, fight = fight_node } = {}) => {
  const sent: ServerPacket[] = []
  const ws = {
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: () => {},
  }
  const graph = {
    read: async (cypher: string, _params?: Record<string, unknown>) => {
      if (cypher.includes(':Fight {id:')) return [{ fight }]
      if (cypher.includes('WHERE c.id IN')) return [{ character, weapon: null }]
      if (cypher.includes(':Fight {world:')) return []
      // seated: the kiosk's HOLDS edge is severed by law, so custody proves nothing and the
      // embody gate must read the seat out of the fight's machine document instead
      if (cypher.includes(':Character {id:'))
        return [
          {
            character,
            held_kiosk: seated ? null : '0xk',
            kiosk: '0xk',
            fight: seated ? fight : null,
            party: null,
            worn: [],
          },
        ]
      if (cypher.includes(':FRIEND')) return []
      if (cypher.includes('RESULT_FOR')) return []
      if (cypher.includes('[:HOLDS]->(i:Item)')) return []
      if (cypher.includes('HOLDS_CLAIM') || cypher.includes('HOLDS_VOUCHER')) return []
      if (cypher.includes('MATCH (s:Sale)') || cypher.includes('MATCH (a:Airdrop)')) return []
      if (cypher.includes(':Trade {id:'))
        return [
          {
            trade: {
              properties: {
                id: '0xt1',
                a: '0xme',
                b: '0xher',
                version: 2,
                accept_a: false,
                accept_b: false,
                locked: false,
                sui_a: '0',
                sui_b: '1000',
                caps_a: '[]',
                caps_b: '[]',
              },
            },
          },
        ]
      if (cypher.includes(':Trade')) return []
      if (cypher.includes('LISTED_IN')) return []
      if (cypher.includes(':Zone')) return []
      if (cypher.includes(':Item {id:'))
        return [
          {
            item: {
              properties: { id: '0xi1', name: 'hat', item_type: 'straw_hat', category: 'hat', level: 3, amount: 1 },
            },
          },
        ]
      return [{ character, kiosk: '0xk', equipment: [], label: 'User', count: 1 }]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  const published: { channel: string; payload: any }[] = []
  const bus = {
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      published.push({ channel, payload })
      emitter.emit(channel, payload)
    },
    close: () => {},
  }
  const pubsub = {
    emitter,
    graph: { ...bus, indexed_checkpoint: async () => 1, sales_history: async () => [] },
    mesh: { ...bus, heartbeat: async () => {}, cluster_online: async () => 7 },
  }
  return { sent, ws, graph, pubsub, published }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const embody = async (player: { on_message: (raw: string) => void }) => {
  player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
  await flush()
}

describe('chat', () => {
  test('chat rides the WORLD channel and forwards to bystanders; the flood gate refuses a burst', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(JSON.stringify({ type: 'packet/chat', character_id: '0xabc', text: 'gg' }))
    const chat = published.find(({ channel }) => channel.startsWith('chat:world:'))
    expect(chat?.channel).toBe('chat:world:overworld')
    expect(chat?.payload).toEqual({ address: '0xme', character: 'nox', text: 'gg' })
    // a bystander's line in the same world forwards as a world chat message
    pubsub.emitter.emit('chat:world:overworld', { address: '0xher', character: 'nyx', text: 'hey' })
    expect(sent.find((packet) => packet.type === 'packet/chat_message')).toEqual({
      type: 'packet/chat_message',
      channel: 'world',
      from: '0xher',
      character: 'nyx',
      text: 'hey',
    })
    player.on_message(JSON.stringify({ type: 'packet/chat', character_id: '0xabc', text: 'again' }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'chat too fast')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:world:'))).toHaveLength(1)
  })

  test('a whisper lands on the target door; the own door forwards inbound whispers', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(JSON.stringify({ type: 'packet/chat_whisper', character_id: '0xabc', to: '0xpal', text: 'psst' }))
    expect(published.some(({ channel }) => channel === 'chat:user:0xpal')).toBe(true)
    pubsub.emitter.emit('chat:user:0xme', { address: '0xpal', character: 'nyx', text: 'yo' })
    expect(sent.find((packet) => packet.type === 'packet/chat_message')).toEqual({
      type: 'packet/chat_message',
      channel: 'whisper',
      from: '0xpal',
      character: 'nyx',
      text: 'yo',
    })
  })

  test('party chat without a party answers a refusal, publishes nothing', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(JSON.stringify({ type: 'packet/chat_party', character_id: '0xabc', text: 'anyone?' }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'no party')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:party'))).toHaveLength(0)
  })
})

describe('the fight watch', () => {
  test('CharacterSeated arms the watch and FightEnded keeps it through settlement', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    pubsub.emitter.emit('evt:character:0xabc', {
      type: 'CharacterSeated',
      data: { fight: '0xf1', character: '0xabc', seat: 0 },
    })
    await flush()
    await flush()
    // arming pushed the live fight row with OUR seat
    const state = sent.find((packet) => packet.type === 'packet/fight_state')
    expect(state).toMatchObject({ type: 'packet/fight_state', seats: { '0xabc': 0 } })
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'TurnSeedUsed', data: { fight: '0xf1', seat: '2', seed: '99' } })
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/turn_seed')).toEqual({
      type: 'packet/turn_seed',
      fight: '0xf1',
      seat: '2',
      seed: '99',
    })
    pubsub.emitter.emit('evt:fight:0xf1', {
      type: 'DropsRolled',
      data: { fight: '0xf1', fighter: '0', drops: [{ item_type: 'silk', qty: 3 }] },
    })
    expect(sent.find((packet) => packet.type === 'packet/fight_drops')).toEqual({
      type: 'packet/fight_drops',
      fight: '0xf1',
      fighter: '0',
      drops: [{ item_type: 'silk', qty: 3 }],
    })
    const checkpoints = sent.filter((packet) => packet.type === 'packet/fight_state').length
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightProjected', data: { fight: '0xf1' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/fight_state')).toHaveLength(checkpoints + 1)
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightEnded', data: { fight: '0xf1', winner: 0 } })
    await flush()
    // settlement can emit DropsRolled after FightEnded, so the seat keeps its watch until
    // CharacterHeld proves custody returned
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'TurnSeedUsed', data: { fight: '0xf1', seat: '3', seed: '1' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/turn_seed')).toHaveLength(2)
  })

  test('a character seated in a fight embodies on its seat and lands back on the board', async () => {
    // THE DUEL INCIDENT (2026-08-21): a seated character has NO kiosk HOLDS edge, so the seat
    // is the only ownership proof — and the gate read a `fighters` prop the projection never
    // writes (the seats live in the machine document). Every seated character was therefore
    // "not your character": no reconnect, no way back to the board, no way out of the fight.
    const { sent, ws, graph, pubsub } = wire({ seated: true })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    await flush()
    // the gate admitted the seat — no "not your character" refusal
    expect(sent.filter((packet) => packet.type === 'packet/error' && packet.reason.includes('character'))).toEqual([])
    expect(sent.find((packet) => packet.type === 'packet/fight_state')).toMatchObject({
      type: 'packet/fight_state',
      fight: '0xf1',
      seats: { '0xabc': 0 },
    })
  })

  test('only the owned seat relays — a spectator may watch but never speak for a fighter', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    const action = { type: 'ready', fighter: '0' } as const
    player.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'not in this fight')).toBeTruthy()
    pubsub.emitter.emit('evt:character:0xabc', {
      type: 'CharacterSeated',
      data: { fight: '0xf1', character: '0xabc', seat: 0 },
    })
    await flush()
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(published.some(({ channel }) => channel === 'act:fight:0xf1')).toBe(true)
    // another fighter's intent forwards; the own echo is silent
    pubsub.emitter.emit('act:fight:0xf1', { address: '0xfoe', action })
    expect(sent.find((packet) => packet.type === 'packet/fight_action')).toEqual({
      type: 'packet/fight_action',
      fight: '0xf1',
      from: '0xfoe',
      action,
    })

    const spectator_wire = wire()
    const spectator = create_player({
      ws: spectator_wire.ws,
      address: '0xwatcher',
      admin: false,
      graph: spectator_wire.graph,
      pubsub: spectator_wire.pubsub,
    })
    await flush()
    await embody(spectator)
    spectator.on_message(JSON.stringify({ type: 'packet/spectate', character_id: '0xabc', fight: '0xf1' }))
    await flush()
    spectator.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(spectator_wire.published.some(({ channel }) => channel === 'act:fight:0xf1')).toBe(false)
    expect(
      spectator_wire.sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'not your fighter')
    ).toBeTruthy()
  })

  test('an active relay names both the owned seat and the projected turn', async () => {
    const machine = JSON.parse(fight_node.properties.machine)
    const active = {
      properties: {
        ...fight_node.properties,
        phase: 'active',
        round: 1,
        machine: JSON.stringify({ ...machine, queue: [0] }),
      },
    }
    const current = wire({ seated: true, fight: active })
    const player = create_player({
      ws: current.ws,
      address: '0xme',
      admin: false,
      graph: current.graph,
      pubsub: current.pubsub,
    })
    await flush()
    await embody(player)
    await flush()
    player.on_message(
      JSON.stringify({
        type: 'packet/fight_action',
        fight: '0xf1',
        action: { type: 'move_to', fighter: '0', path: ['7'] },
      })
    )
    expect(current.published.some(({ channel }) => channel === 'act:fight:0xf1')).toBe(true)

    const wrong_turn = {
      ...active,
      properties: { ...active.properties, machine: JSON.stringify({ ...machine, queue: [1] }) },
    }
    const waiting = wire({ seated: true, fight: wrong_turn })
    const waiting_player = create_player({
      ws: waiting.ws,
      address: '0xme',
      admin: false,
      graph: waiting.graph,
      pubsub: waiting.pubsub,
    })
    await flush()
    await embody(waiting_player)
    waiting_player.on_message(
      JSON.stringify({
        type: 'packet/fight_action',
        fight: '0xf1',
        action: { type: 'move_to', fighter: '0', path: ['7'] },
      })
    )
    expect(waiting.published.some(({ channel }) => channel === 'act:fight:0xf1')).toBe(false)
    expect(waiting.sent.some((packet) => packet.type === 'packet/error' && packet.reason === 'not your turn')).toBe(
      true
    )
  })
})

describe('market + self stream + heartbeat', () => {
  test('shop state streams exact external supply and airdrop counts, without echoing own receipts', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    pubsub.emitter.emit('evt:economy', {
      type: 'SaleBought',
      data: { item_type: 'berserk', buyer: '0xher', supply: '75' },
    })
    pubsub.emitter.emit('evt:economy', {
      type: 'AirdropClaimed',
      data: { drop_id: 'founders', claimer: '0xher', remaining: '1' },
    })
    pubsub.emitter.emit('evt:economy', {
      type: 'SaleBought',
      data: { item_type: 'berserk', buyer: '0xme', supply: '74' },
    })
    expect(sent.find((packet) => packet.type === 'packet/shop_supply')).toEqual({
      type: 'packet/shop_supply',
      item_type: 'berserk',
      supply: '75',
    })
    expect(sent.find((packet) => packet.type === 'packet/airdrop_remaining')).toEqual({
      type: 'packet/airdrop_remaining',
      drop_id: 'founders',
      eligible_count: 1,
    })
    expect(sent.filter((packet) => packet.type === 'packet/shop_supply')).toHaveLength(1)
  })

  test('market_observe folds and pushes the slice; my kiosk sale always forwards', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(
      JSON.stringify({
        type: 'packet/market_observe',
        observation: { categories: ['hat'], characters: false },
      })
    )
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/market_slice')).toMatchObject({
      observation: { categories: ['hat'], characters: false },
    })
    pubsub.emitter.emit('evt:economy', {
      type: 'MarketPurchased',
      data: { kiosk: '0xk', object: '0xi9', buyer: '0xother', kind: 'item', price_mist: '5000' },
    })
    expect(sent.find((packet) => packet.type === 'packet/listing_sold')).toEqual({
      type: 'packet/listing_sold',
      object: '0xi9',
      price_mist: '5000',
    })
    const roster_packets = sent.filter((packet) => packet.type === 'packet/characters').length
    pubsub.emitter.emit('evt:economy', {
      type: 'MarketPurchased',
      data: { kiosk: '0xother-kiosk', object: '0xc9', buyer: '0xme', kind: 'character', price_mist: '5000' },
    })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/characters')).toHaveLength(roster_packets + 1)
  })

  test('a party invite naming my character forwards from the self stream', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    pubsub.emitter.emit('evt:character:0xabc', { type: 'PartyInvited', data: { party: '0xp1', character: '0xabc' } })
    expect(sent.find((packet) => packet.type === 'packet/party_invited')).toEqual({
      type: 'packet/party_invited',
      party: '0xp1',
      character: '0xabc',
    })
  })

  test('a trade birth arms the stream; changes re-push the row; destroy disarms', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    pubsub.emitter.emit('evt:social:0xme', { type: 'TradeCreated', data: { trade: '0xt1', a: '0xme', b: '0xher' } })
    await flush()
    const pushed = sent.filter((packet) => packet.type === 'packet/trade')
    expect(pushed).toHaveLength(1)
    expect((pushed[0] as { trade: { id: string; sui_b: string } }).trade).toMatchObject({ id: '0xt1', sui_b: '1000' })
    pubsub.emitter.emit('evt:trade:0xt1', { type: 'TradeChanged', data: { trade: '0xt1', version: '3' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/trade')).toHaveLength(2)
    pubsub.emitter.emit('evt:trade:0xt1', { type: 'TradeDestroyed', data: { trade: '0xt1' } })
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/trade_destroyed')).toEqual({
      type: 'packet/trade_destroyed',
      trade: '0xt1',
    })
    // disarmed: further facts stay silent
    pubsub.emitter.emit('evt:trade:0xt1', { type: 'TradeChanged', data: { trade: '0xt1', version: '4' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/trade')).toHaveLength(2)
  })

  test('the heartbeat pushes the cluster-wide count', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub, indexing_lag: async () => 42 })
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/server_info')).toEqual({
      type: 'packet/server_info',
      online: 7,
      indexing_lag: 42,
    })
  })

  test('the shared game snapshot and each freeze transition reach the player immediately', () => {
    const { sent, ws, graph, pubsub } = wire()
    let listener = (_frozen: boolean | null): void => {}
    create_player({
      ws,
      address: '0xme',
      admin: false,
      graph,
      pubsub,
      game_state: {
        get: () => false,
        listen: (next) => {
          listener = next
          return () => {
            listener = () => {}
          }
        },
        start: async () => {},
      },
    })

    expect(sent.find((packet) => packet.type === 'packet/game_state')).toEqual({
      type: 'packet/game_state',
      frozen: false,
    })
    listener(true)
    expect(sent.filter((packet) => packet.type === 'packet/game_state').at(-1)).toEqual({
      type: 'packet/game_state',
      frozen: true,
    })
  })
})
