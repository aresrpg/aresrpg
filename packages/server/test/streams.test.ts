// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The new stream surfaces: chat (mesh + flood gate), the fight watch (armed by the chain,
// disarmed by the chain), market observation (state-fold → push), the self stream's party
// invite, and the cluster heartbeat packet.

import { describe, expect, test } from 'bun:test'

import { create_player } from '../src/player.ts'

import { embody, fight_node, flush, wire } from './helpers/stream_wire.ts'

describe('chat', () => {
  test('chat rides the WORLD channel and forwards to bystanders; the flood gate refuses a burst', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(
      JSON.stringify({
        type: 'packet/chat',
        character_id: '0xabc',
        parts: [
          { kind: 'text', text: 'gg ' },
          { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
        ],
      })
    )
    const chat = published.find(({ channel }) => channel.startsWith('chat:world:'))
    expect(chat?.channel).toBe('chat:world:overworld')
    expect(chat?.payload).toEqual({
      address: '0xme',
      character_id: '0xabc',
      character: 'nox',
      parts: [
        { kind: 'text', text: 'gg ' },
        { kind: 'item', id: '0xhat', name: 'Fuwa Hat' },
      ],
    })
    // a bystander's line in the same world forwards as a world chat message
    pubsub.emitter.emit('chat:world:overworld', {
      address: '0xher',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'hey' }],
    })
    expect(sent.find((packet) => packet.type === 'packet/chat_message')).toEqual({
      type: 'packet/chat_message',
      channel: 'world',
      scope: null,
      from: '0xher',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'hey' }],
    })
    player.on_message(
      JSON.stringify({ type: 'packet/chat', character_id: '0xabc', parts: [{ kind: 'text', text: 'again' }] })
    )
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'chat too fast')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:world:'))).toHaveLength(1)
  })

  test('a whisper lands on the target door; the own door forwards inbound whispers', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(
      JSON.stringify({
        type: 'packet/chat_whisper',
        character_id: '0xabc',
        to: '0xpal',
        parts: [
          { kind: 'text', text: 'psst ' },
          { kind: 'position', world: 'overworld', x: 100, z: 100 },
          { kind: 'text', text: ' Senshi Lvl 10 (0%)' },
        ],
      })
    )
    const whisper = published.find(({ channel }) => channel === 'chat:user:0xpal')
    expect(whisper?.payload).toMatchObject({
      parts: [
        { kind: 'text', text: 'psst ' },
        { kind: 'position', world: 'overworld', x: 100, z: 100 },
        { kind: 'text', text: ' Senshi Lvl 10 (0%)' },
      ],
    })
    pubsub.emitter.emit('chat:user:0xme', {
      address: '0xpal',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'yo' }],
    })
    expect(sent.find((packet) => packet.type === 'packet/chat_message')).toEqual({
      type: 'packet/chat_message',
      channel: 'whisper',
      scope: null,
      from: '0xpal',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'yo' }],
    })
  })

  test('party chat without a party answers a refusal, publishes nothing', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.on_message(
      JSON.stringify({ type: 'packet/chat_party', character_id: '0xabc', parts: [{ kind: 'text', text: 'anyone?' }] })
    )
    expect(sent.find((packet) => packet.type === 'packet/error' && packet.reason === 'no party')).toBeTruthy()
    expect(published.filter(({ channel }) => channel.startsWith('chat:party'))).toHaveLength(0)
  })

  test('party chat stays scoped to the acting character party', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    player.dispatch({ type: 'action/party', character_id: '0xabc', party: '0xp' })
    await flush()
    player.on_message(
      JSON.stringify({ type: 'packet/chat_party', character_id: '0xabc', parts: [{ kind: 'text', text: 'ready' }] })
    )
    expect(published.some(({ channel }) => channel === 'chat:party:0xp')).toBeTrue()
    pubsub.emitter.emit('chat:party:0xp', {
      address: '0xher',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'go' }],
    })
    expect(sent.find((packet) => packet.type === 'packet/chat_message' && packet.channel === 'party')).toEqual({
      type: 'packet/chat_message',
      channel: 'party',
      scope: '0xp',
      from: '0xher',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'go' }],
    })
  })
})

describe('the fight watch', () => {
  test('arming a character watch closes the initial durable-resolution snapshot gap', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/fight_resolutions').length).toBeGreaterThanOrEqual(2)
  })

  test('CharacterHeld forwards the freshly projected Character fields', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    const before = sent.filter((packet) => packet.type === 'packet/characters').length
    pubsub.emitter.emit('evt:character:0xabc', {
      type: 'CharacterHeld',
      data: { character: '0xabc', kiosk: '0xk' },
    })
    await flush()
    const rosters = sent.filter((packet) => packet.type === 'packet/characters')
    expect(rosters).toHaveLength(before + 1)
    expect(rosters.at(-1)?.characters.some(({ id, level }) => id === '0xabc' && level === 10)).toBeTrue()
  })

  test('a newly purchased character refreshes from the buyer social door', async () => {
    const { sent, ws, graph, pubsub } = wire()
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    const before = sent.filter((packet) => packet.type === 'packet/characters').length
    pubsub.emitter.emit('evt:social:0xme', {
      type: 'CharacterHeld',
      data: { character: '0xnew', kiosk: '0xk' },
    })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/characters')).toHaveLength(before + 1)
  })

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
    expect(state?.state.players['0xabc']).toMatchObject({
      sex: 'male',
      color_1: 1,
      color_2: 2,
      color_3: 3,
    })
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
    const recovery_packets = sent.filter((packet) => packet.type === 'packet/closable_fights').length
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightClosable', data: { fight: '0xf1' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/closable_fights')).toHaveLength(recovery_packets)
    pubsub.emitter.emit('evt:fight:0xf1', { type: 'FightClosed', data: { fight: '0xf1' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/closable_fights').at(-1)).toEqual({
      type: 'packet/closable_fights',
      fights: [],
    })
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
    const before = sent.filter((packet) => packet.type === 'packet/fight_state').length
    player.on_message(JSON.stringify({ type: 'packet/spectate', character_id: '0xabc', fight: '0xf1' }))
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/fight_state')).toHaveLength(before + 1)
  })

  test('only the owned seat relays — a spectator may watch but never speak for a fighter', async () => {
    const machine = JSON.parse(String(fight_node.properties.machine))
    const active_fight = {
      properties: {
        ...fight_node.properties,
        phase: 'active',
        round: 1,
        machine: JSON.stringify({ ...machine, queue: [0] }),
      },
    }
    const { sent, ws, graph, pubsub, published } = wire({ fight: active_fight })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    const action = { type: 'move_to', fighter: '0', path: ['1'] } as const
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
    pubsub.emitter.emit('act:fight:0xf1', { kind: 'action', address: '0xfoe', action })
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
    expect(sent.find((packet) => packet.type === 'packet/market_counts')).toEqual({
      type: 'packet/market_counts',
      counts: { categories: {}, characters: 0 },
    })
    pubsub.emitter.emit('evt:economy', {
      ckpt: 10,
      tx: 2,
      evt: 3,
      ts_ms: 1_000,
      type: 'MarketPurchased',
      data: {
        kiosk: '0xk',
        seller: '0xme',
        object: '0xi9',
        buyer: '0xother',
        kind: 'item',
        name: 'Rune PA Fo',
        item_type: 'rune_action_pa',
        amount: 1,
        price_mist: '5000',
      },
    })
    expect(sent.find((packet) => packet.type === 'packet/listing_sold')).toEqual({
      type: 'packet/listing_sold',
      sale: {
        id: '10:2:3',
        object: '0xi9',
        kind: 'item',
        name: 'Rune PA Fo',
        item_type: 'rune_action_pa',
        amount: 1,
        price_mist: '5000',
        counterparty: '0xother',
        ts_ms: 1_000,
      },
    })
    const roster_packets = sent.filter((packet) => packet.type === 'packet/characters').length
    pubsub.emitter.emit('evt:economy', {
      type: 'MarketPurchased',
      data: {
        kiosk: '0xother-kiosk',
        seller: '0xother',
        object: '0xc9',
        buyer: '0xme',
        kind: 'character',
        price_mist: '5000',
      },
    })
    await flush()
    // custody, not sale analysis, owns marketplace character roster refreshes
    expect(sent.filter((packet) => packet.type === 'packet/characters')).toHaveLength(roster_packets)
  })

  test('a party invite naming my character forwards from the self stream', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await embody(player)
    pubsub.emitter.emit('evt:character:0xabc', {
      type: 'PartyInvitesChanged',
      data: { party: '0xp1', character: '0xabc' },
    })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/party_invites').at(-1)).toEqual({
      type: 'packet/party_invites',
      character_id: '0xabc',
      parties: [],
    })
  })

  test('every trade write reconciles the same bounded address roster', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    const before = sent.filter((packet) => packet.type === 'packet/trades').length
    pubsub.emitter.emit('evt:social:0xme', { type: 'TradeChanged', data: { trade: '0xt1' } })
    await flush()
    expect(sent.filter((packet) => packet.type === 'packet/trades')).toHaveLength(before + 1)
    pubsub.emitter.emit('evt:social:0xme', { type: 'TradeDestroyed', data: { trade: '0xt1' } })
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/trade_destroyed')).toEqual({
      type: 'packet/trade_destroyed',
      trade: '0xt1',
    })
    expect(sent.filter((packet) => packet.type === 'packet/trades')).toHaveLength(before + 2)
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
