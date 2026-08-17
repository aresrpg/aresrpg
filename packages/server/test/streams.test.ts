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
    fighters: JSON.stringify([{ kind: 'player', character: '0xabc', owner: '0xme' }]),
  },
}

const wire = () => {
  const sent: ServerPacket[] = []
  const ws = {
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: () => {},
  }
  const graph = {
    read: async (cypher: string, _params?: Record<string, unknown>) => {
      if (cypher.includes(':Fight {id:')) return [{ fight: fight_node }]
      if (cypher.includes(':Character {id:'))
        return [{ character, held_kiosk: '0xk', kiosk: '0xk', fight: null, party: null, worn: [] }]
      if (cypher.includes(':FRIEND')) return []
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
              properties: { id: '0xi1', name: 'hat', item_type: 'straw_hat', category: 'helmet', level: 3, amount: 1 },
            },
          },
        ]
      return [{ character, kiosk: '0xk', equipment: [], label: 'User', count: 1 }]
    },
    close: async () => {},
  }
  const emitter = new EventEmitter()
  const published: { channel: string; payload: any }[] = []
  const pubsub = {
    emitter,
    heartbeat: async () => {},
    cluster_online: async () => 7,
    indexed_checkpoint: async () => 1,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      published.push({ channel, payload })
      emitter.emit(channel, payload)
    },
    close: () => {},
  }
  return { sent, ws, graph, pubsub, published }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const embody = async (player: { on_message: (raw: string) => void }) => {
  player.on_message(JSON.stringify({ type: 'packet/embody', character_id: '0xabc' }))
  await flush()
}

describe('chat', () => {
  test('chat rides the WORLD channel and forwards to bystanders; the flood gate refuses a burst', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(JSON.stringify({ type: 'packet/chat', text: 'gg' }))
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
    player.on_message(JSON.stringify({ type: 'packet/chat', text: 'again' }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'chat too fast')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:world:'))).toHaveLength(1)
  })

  test('a whisper lands on the target door; the own door forwards inbound whispers', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(JSON.stringify({ type: 'packet/chat_whisper', to: '0xpal', text: 'psst' }))
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
    player.on_message(JSON.stringify({ type: 'packet/chat_party', text: 'anyone?' }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'no party')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:party'))).toHaveLength(0)
  })
})

describe('the fight watch', () => {
  test('FighterJoined on the self stream arms the watch; the chain stream forwards; FightEnded disarms', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    pubsub.emitter.emit('evt:character:0xabc', { type: 'FighterJoined', data: { fight: '0xf1', character: '0xabc' } })
    await flush()
    // arming pushed the live fight row with OUR seat
    const state = sent.find((packet) => packet.type === 'packet/fight_state')
    expect(state).toMatchObject({ type: 'packet/fight_state', seat: 0 })
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'MobTurnPlayed', data: { fight: '0xf1', seat: '2', seed: '99' } })
    expect(sent.find((packet) => packet.type === 'packet/mob_turn')).toEqual({
      type: 'packet/mob_turn',
      fight: '0xf1',
      seat: '2',
      seed: '99',
    })
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightEnded', data: { fight: '0xf1', winner: 0 } })
    await flush()
    // disarmed: further fight facts stay silent
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'MobTurnPlayed', data: { fight: '0xf1', seat: '3', seed: '1' } })
    expect(sent.filter((packet) => packet.type === 'packet/mob_turn')).toHaveLength(1)
  })

  test('a fight action relays only within the armed fight', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    const action = { type: 'move_to', fighter: '0', path: ['7'] } as const
    player.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'not in this fight')).toBeTruthy()
    pubsub.emitter.emit('evt:character:0xabc', { type: 'FighterJoined', data: { fight: '0xf1', character: '0xabc' } })
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
    player.on_message(JSON.stringify({ type: 'packet/market_observe', category: 'helmet' }))
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/market_slice')).toMatchObject({ category: 'helmet' })
    pubsub.emitter.emit('evt:economy', {
      type: 'MarketPurchased',
      data: { kiosk: '0xk', object: '0xi9', price_mist: '5000' },
    })
    expect(sent.find((packet) => packet.type === 'packet/listing_sold')).toEqual({
      type: 'packet/listing_sold',
      object: '0xi9',
      price_mist: '5000',
    })
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
})
