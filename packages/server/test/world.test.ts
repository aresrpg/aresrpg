// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The seat in the world, through the real player harness: tracking from the indexed roster, presence
// between accounts, the speed law and checkpoint provenance, chat, and the fight relay's authority.

import { expect, test } from 'bun:test'

import { channels } from '../src/protocol.ts'

import { create_player, fight_node, flush, settle, types_of, wire, type Wire } from './harness.ts'

const UNMOUNTED = Object.freeze({ riding: false, gliding: false })
const ZONE_RECENTER_MS = 1_000
const step = (
  f: Wire,
  character_id: string,
  x: number,
  motion: object = UNMOUNTED,
  checkpoint = f.checkpoint(character_id)
) => JSON.stringify({ type: 'packet/position', character_id, checkpoint, x, y: 0, z: 100, ...motion })
const chat = (type: string, character_id: string, text: string, to?: string) =>
  JSON.stringify({ type, character_id, ...(to ? { to } : {}), parts: [{ kind: 'text', text }] })
const moves = (f: Wire, kind: string, character_id?: string) =>
  f.published.filter(({ payload }) => payload.kind === kind && (!character_id || payload.character_id === character_id))
const stranger = (index: number) => ({
  character_id: `0xp${index}`,
  world: 'overworld',
  ...UNMOUNTED,
  name: `p${index}`,
  classe: 'senshi',
  sex: 'male',
  level: 1,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  pet: null,
  x: 100,
  y: 0,
  z: 100,
})

test('the roster mounts each hero window; two accounts see each other move and talk, and a later joiner is answered', async () => {
  const first = wire({ character_ids: ['0xa'] })
  const first_player = create_player({ ...first, address: '0xfirst' })
  await settle()
  expect(first.sent).toContainEqual(expect.objectContaining({ type: 'packet/tracked_zones', character_id: '0xa' }))
  expect(types_of(first.sent)).toContain('packet/zones')
  expect(moves(first, 'appear').length + moves(first, 'who').length).toBeGreaterThan(1)
  const second = wire({ character_ids: ['0xb'], shared_pubsub: first.pubsub })
  const second_player = create_player({ ...second, address: '0xsecond' })
  try {
    await settle()
    const appeared = (f: Wire, id: string) =>
      f.sent.some((packet) => packet.type === 'packet/player_appeared' && packet.player.character_id === id)
    expect([appeared(first, '0xb'), appeared(second, '0xa')]).toEqual([true, true])
    second_player.on_message(step(second, '0xb', 101))
    await Bun.sleep(60)
    expect(
      first.sent.some((packet) => packet.type === 'packet/players_moved' && packet.positions[0]?.character_id === '0xb')
    ).toBe(true)
    second_player.on_message(chat('packet/chat', '0xb', 'hello'))
    second_player.on_message(chat('packet/chat', '0xb', 'again'))
    await settle()
    expect(first.sent.find(({ type }) => type === 'packet/chat_message')).toMatchObject({
      channel: 'world',
      from: '0xsecond',
      parts: [{ text: 'hello' }],
    })
    expect(second.sent).toContainEqual({ type: 'packet/error', reason: 'chat too fast' })
    expect(first.published.filter(({ channel }) => channel.startsWith('chat:world:'))).toHaveLength(1)
    // A later joiner probing my zone is answered once, on its own reply door.
    first.published.length = 0
    first.pubsub.emitter.emit('pos:overworld:0:0', {
      kind: 'who',
      reply_to: 'presence:reply:t',
      request: 't',
      address: '0xlater',
      world: 'overworld',
      zx: 0,
      zz: 0,
    })
    expect(first.published.filter(({ payload }) => payload.kind === 'reply').map(({ channel }) => channel)).toEqual([
      'presence:reply:t',
      'presence:reply:t',
    ])
  } finally {
    first_player.on_close()
    second_player.on_close()
  }
})

test('a whisper lands on the target door, party chat needs a party, and party chat stays in the acting party', async () => {
  const f = wire({ character_ids: ['0xabc'] })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    player.on_message(chat('packet/chat_party', '0xabc', 'anyone?'))
    expect(f.sent).toContainEqual({ type: 'packet/error', reason: 'no party' })
    player.on_message(chat('packet/chat_whisper', '0xabc', 'psst', '0xpal'))
    await settle()
    expect(f.published.find(({ channel }) => channel === 'chat:user:0xpal')?.payload).toMatchObject({
      character: 'nox',
      parts: [{ text: 'psst' }],
    })
    f.pubsub.emitter.emit('chat:user:0xme', {
      address: '0xpal',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'yo' }],
    })
    expect(f.sent.find(({ type }) => type === 'packet/chat_message')).toMatchObject({
      channel: 'whisper',
      from: '0xpal',
    })
    f.pubsub.emitter.emit(channels.character('0xabc'), {
      type: 'PartyJoined',
      data: { party: '0xp', character: '0xabc' },
    })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/party').at(-1)).toMatchObject({
      character_id: '0xabc',
      party: { id: '0xp' },
    })
    await Bun.sleep(1_000)
    player.on_message(chat('packet/chat_party', '0xabc', 'ready'))
    await settle()
    expect(f.published.some(({ channel }) => channel === 'chat:party:0xp')).toBe(true)
    f.pubsub.emitter.emit('chat:party:0xp', {
      address: '0xher',
      character_id: '0xnyx',
      character: 'nyx',
      parts: [{ kind: 'text', text: 'go' }],
    })
    expect(f.sent.filter(({ type }) => type === 'packet/chat_message').at(-1)).toMatchObject({
      channel: 'party',
      scope: '0xp',
      from: '0xher',
    })
  } finally {
    player.on_close()
  }
})

test('party membership read after the character channel is armed reaches the seat', async () => {
  const f = wire({ character_ids: ['0xabc'], party: '0xp' })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    expect(
      f.sent.filter((packet) => packet.type === 'packet/party' && packet.character_id === '0xabc').at(-1)
    ).toMatchObject({ party: { id: '0xp' } })
    f.pubsub.emitter.emit(channels.character('0xabc'), {
      type: 'PartyInvitesChanged',
      data: { party: '0xp1', character: '0xabc' },
    })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/party_invites').at(-1)).toEqual({
      type: 'packet/party_invites',
      character_id: '0xabc',
      parties: [],
    })
  } finally {
    player.on_close()
  }
})

test('the speed law: an impossible move drops, a buffered burst spends the bank, and a mount raises the authored ceiling', async () => {
  const walker = wire()
  const walking = create_player({ ...walker, address: '0xme' })
  await settle()
  // The first move prices against the checkpoint's own timestamp: 500 blocks in 60 s is legal.
  walking.on_message(step(walker, '0xabc', 600))
  for (let offset = 1; offset <= 6; offset++) walking.on_message(step(walker, '0xabc', 600 + offset))
  expect(walker.dropped).toEqual([])
  expect(moves(walker, 'move', '0xabc').length).toBeGreaterThan(0)
  walking.on_message(step(walker, '0xabc', 700))
  expect(walker.dropped).toEqual(['SPEED'])
  walking.on_close()
  // 850 blocks over the checkpoint's 60 s: above the 11.5 walking law, below the 17.25 mounted one.
  for (const [pet, motion, dropped] of [
    [false, UNMOUNTED, ['SPEED']],
    [true, { riding: true, gliding: false }, []],
  ] as const) {
    const f = wire({ pet })
    const player = create_player({ ...f, address: '0xme' })
    await settle()
    player.on_message(step(f, '0xabc', 950, motion))
    expect(f.dropped).toEqual([...dropped])
    player.on_close()
  }
  // A glide stands only on an equipped pet and an active ride.
  for (const [pet, riding, gliding] of [
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ] as const) {
    const f = wire({ pet, character_ids: ['0xabc'] })
    const player = create_player({ ...f, address: '0xme' })
    await settle()
    player.on_message(step(f, '0xabc', 100, { riding, gliding: true }))
    expect(moves(f, 'move')[0]?.payload).toMatchObject({ gliding })
    player.on_close()
  }
})

test('a position outside the roster or under an old checkpoint is ignored; walking resumes on the new checkpoint', async () => {
  let recalled = false
  const f = wire({
    character_ids: ['0xabc'],
    respond: (query) =>
      recalled && query.includes('[:HOLDS]->(c:Character)')
        ? [
            {
              character: {
                properties: {
                  id: '0xabc',
                  name: 'nox',
                  world: 'overworld',
                  checkpoint_world: 'overworld',
                  x: 5_000,
                  z: 100,
                  at_ms: Date.now(),
                },
              },
              kiosk_node: { properties: { id: '0xk' } },
              equipment: [],
            },
          ]
        : undefined,
  })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    const old_checkpoint = f.checkpoint('0xabc')
    player.on_message(step(f, '0xother', 10_000, UNMOUNTED, old_checkpoint))
    expect([f.dropped, moves(f, 'move')]).toEqual([[], []])
    recalled = true
    f.pubsub.emitter.emit(channels.character('0xabc'), { type: 'CharacterTeleported', data: { character: '0xabc' } })
    await settle()
    const fresh = `overworld:5000:100:${f.sent.filter((p) => p.type === 'packet/characters').at(-1)?.characters[0]?.at_ms}`
    // A late packet from before the recall is ignored, not priced against the new anchor.
    player.on_message(step(f, '0xabc', 101, UNMOUNTED, old_checkpoint))
    expect([f.dropped, moves(f, 'move')]).toEqual([[], []])
    player.on_message(step(f, '0xabc', 5_001, UNMOUNTED, fresh))
    expect([f.dropped, moves(f, 'move', '0xabc').length]).toEqual([[], 1])
    player.on_message(step(f, '0xabc', 9_000, UNMOUNTED, fresh))
    expect(f.dropped).toEqual(['SPEED'])
  } finally {
    player.on_close()
  }
})

test('a zone crossing retires the departed window, and a refused read there drops that socket alone', async () => {
  let refused = false
  const f = wire({
    character_ids: ['0xabc'],
    respond: (query) => {
      if (refused && query.includes(':Fight {world:')) throw new Error('Max pending queries exceeded')
      return undefined
    },
  })
  const player = create_player({ ...f, address: '0xme' })
  await settle()
  f.pubsub.emitter.emit('pos:overworld:-1:0', {
    kind: 'appear',
    address: '0xold',
    player: { ...stranger(1), character_id: '0xold', x: -100 },
  })
  await settle()
  expect(types_of(f.sent)).toContain('packet/player_appeared')
  refused = true
  player.dispatch({
    type: 'action/move',
    character_id: '0xabc',
    x: 1_100,
    y: 0,
    z: 100,
    ...UNMOUNTED,
    at_ms: Date.now(),
    budget_blocks: 0,
  })
  await Bun.sleep(ZONE_RECENTER_MS + 100)
  expect(f.sent).toContainEqual({ type: 'packet/player_left', character_id: '0xold' })
  expect(f.dropped).toContain('SNAPSHOT_FAILED')
  player.on_close()
})

test('visibility caps strangers at 100 while friends always pass, and far movers are throttled', async () => {
  const f = wire({ friends: ['0xbestie'] })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    for (let index = 0; index < 120; index++)
      f.pubsub.emitter.emit('pos:overworld:0:0', { kind: 'appear', address: `0xs${index}`, player: stranger(index) })
    f.pubsub.emitter.emit('pos:overworld:0:0', { kind: 'appear', address: '0xbestie', player: stranger(999) })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/player_appeared')).toHaveLength(101)
    const move = (index: number, x: number) =>
      f.pubsub.emitter.emit('pos:overworld:0:0', {
        kind: 'move',
        ...UNMOUNTED,
        character_id: `0xp${index}`,
        address: `0xs${index}`,
        x,
        y: 0,
        z: 300,
      })
    move(115, 105)
    for (let offset = 0; offset < 4; offset++) move(6, 300 + offset)
    await Bun.sleep(60)
    const moved = f.sent.flatMap((packet) => (packet.type === 'packet/players_moved' ? packet.positions : []))
    expect(moved.map(({ character_id, x }) => [character_id, x])).toEqual([['0xp6', 303]])
  } finally {
    player.on_close()
  }
})

test('a dungeon hero leaves world presence, ignores movement and receives only its lobby', async () => {
  const f = wire({ dungeon_run: '{"dungeon":"tangled_aftermath","room":"1","seed":"9"}', character_ids: ['0xabc'] })
  const player = create_player({ ...f, address: '0xme' })
  try {
    await settle()
    expect(types_of(f.sent)).not.toContain('packet/tracked_zones')
    expect(f.sent).toContainEqual({
      type: 'packet/dungeon_lobby',
      lobby: {
        dungeon: 'tangled_aftermath',
        players: [{ character_id: '0xabc', name: 'nox', level: 10, room: 1 }],
        fights: [],
      },
    })
    f.pubsub.emitter.emit('evt:dungeon:tangled_aftermath', { type: 'DungeonLobbyChanged', data: {} })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/dungeon_lobby')).toHaveLength(2)
    player.on_message(step(f, '0xabc', 130))
    expect([f.published.filter(({ payload }) => payload.kind === 'move'), f.dropped]).toEqual([[], []])
  } finally {
    player.on_close()
  }
})

test('a seated hero embodies on its seat; only that seat relays on its turn, and a spectator never speaks for it', async () => {
  const active = fight_node({ queue: [0] }, 'active')
  const f = wire({ seated: active })
  const player = create_player({ ...f, address: '0xme' })
  const watcher = wire({ owns: true, shared_pubsub: f.pubsub, character_ids: ['0xw'] })
  const spectator = create_player({ ...watcher, address: '0xwatcher' })
  try {
    await settle()
    expect(f.sent.find(({ type }) => type === 'packet/characters')).toMatchObject({
      characters: expect.arrayContaining([
        expect.objectContaining({ id: '0xabc', custody: 'fight', kiosk: '0xk', active_fight: { id: '0xf1', seat: 0 } }),
      ]),
    })
    expect(f.sent.find(({ type }) => type === 'packet/fight_state')).toMatchObject({
      fight: '0xf1',
      seats: { '0xabc': 0 },
    })
    expect(f.sent.filter((packet) => packet.type === 'packet/error')).toEqual([])
    const action = { type: 'move_to', fighter: '0', path: ['7'] } as const
    player.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(f.published.filter(({ channel }) => channel === 'act:fight:0xf1')).toHaveLength(1)
    f.pubsub.emitter.emit('act:fight:0xf1', { kind: 'action', address: '0xfoe', action })
    expect(f.sent.find(({ type }) => type === 'packet/fight_action')).toEqual({
      type: 'packet/fight_action',
      fight: '0xf1',
      from: '0xfoe',
      action,
    })
    player.on_message(
      JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action: { ...action, fighter: '1' } })
    )
    expect(f.sent).toContainEqual({ type: 'packet/error', reason: 'not in this fight' })
    spectator.on_message(JSON.stringify({ type: 'packet/spectate', character_id: '0xw', fight: '0xf1' }))
    await settle()
    expect(watcher.sent.some(({ type }) => type === 'packet/fight_state')).toBe(true)
    spectator.on_message(JSON.stringify({ type: 'packet/fight_action', fight: '0xf1', action }))
    expect(watcher.sent).toContainEqual({ type: 'packet/error', reason: 'not your fighter' })
    // A participant asks every watcher to resync; a spectator rereads alone; a stranger is refused.
    const relays = f.published.length
    player.on_message(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf1' }))
    spectator.on_message(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf1' }))
    spectator.on_message(JSON.stringify({ type: 'packet/fight_resync', fight: '0xf2' }))
    expect(f.published.slice(relays).map(({ payload }) => payload.kind)).toEqual(['resync'])
    expect(watcher.sent.at(-1)).toEqual({ type: 'packet/error', reason: 'not in this fight' })
  } finally {
    player.on_close()
    spectator.on_close()
  }
})

test('the fight stream follows the chain from seat to close, and a stale checkpoint read never overwrites a newer one', async () => {
  const reads: ReturnType<typeof Promise.withResolvers<void>>[] = []
  let gated = false
  const f = wire({
    character_ids: ['0xabc'],
    respond: async (query) => {
      if (!gated || !query.includes('k:Kolizeum {fight_id: $fight_id}')) return undefined
      const read = Promise.withResolvers<void>()
      reads.push(read)
      await read.promise
      return [{ fight: fight_node({}, reads.length === 1 ? 'placement' : 'active'), tournament: null }]
    },
  })
  const player = create_player({ ...f, address: '0xme' })
  const states = () => f.sent.filter((packet) => packet.type === 'packet/fight_state')
  try {
    await settle()
    gated = true
    f.pubsub.emitter.emit(channels.character('0xabc'), {
      type: 'CharacterSeated',
      data: { fight: '0xf1', character: '0xabc', seat: 0 },
    })
    await settle()
    f.pubsub.emitter.emit(channels.fight('0xf1'), { type: 'FighterJoined', data: { fight: '0xf1' } })
    await settle()
    reads[1]!.resolve()
    await settle()
    reads[0]!.resolve()
    await settle()
    expect(states().map((packet) => packet.state.contract)).toEqual([expect.objectContaining({ round: 1 })])
    gated = false
    for (const [type, data] of [
      ['TurnSeedUsed', { fight: '0xf1', seat: '2', seed: '99' }],
      ['DropsRolled', { fight: '0xf1', fighter: '0', kares: '0', drops: [{ item_type: 'silk', qty: 3 }] }],
      ['FightProjected', { fight: '0xf1' }],
      ['FightEnded', { fight: '0xf1', winner: 0 }],
      ['TurnSeedUsed', { fight: '0xf1', seat: '3', seed: '1' }],
      ['FightClosed', { fight: '0xf1' }],
    ] as const)
      f.pubsub.emitter.emit(channels.fight('0xf1'), { type, data })
    await settle()
    expect(f.sent.filter(({ type }) => type === 'packet/turn_seed')).toHaveLength(2)
    expect(f.sent).toContainEqual({
      type: 'packet/fight_drops',
      fight: '0xf1',
      fighter: '0',
      kares: '0',
      drops: [{ item_type: 'silk', qty: 3 }],
    })
    expect(f.sent).toContainEqual({ type: 'packet/fight_ended', fight: '0xf1', winner: 0 })
    expect(types_of(f.sent).filter((type) => type === 'packet/closable_fights')).toHaveLength(2)
    f.pubsub.emitter.emit(channels.character('0xabc'), { type: 'CharacterHeld', data: { character: '0xabc' } })
    await flush()
    const seeds = types_of(f.sent).filter((type) => type === 'packet/turn_seed').length
    f.pubsub.emitter.emit(channels.fight('0xf1'), {
      type: 'TurnSeedUsed',
      data: { fight: '0xf1', seat: '4', seed: '2' },
    })
    await settle()
    expect(types_of(f.sent).filter((type) => type === 'packet/turn_seed')).toHaveLength(seeds)
  } finally {
    player.on_close()
  }
})

test('a seat never acts for a character of another address: every packet naming one changes nothing', async () => {
  const seat = (character: string, owner: string) => ({
    team: 0,
    kind: { player: { character, owner, level: 10 } },
    hp: 100,
    settled: false,
  })
  const fight = fight_node({ queue: [0], fighters: [seat('0xa2', '0xalice'), seat('0xb2', '0xbob')] }, 'active')
  const alice = wire({ character_ids: ['0xa2', '0xa'], seated: fight })
  const bob = wire({ character_ids: ['0xb2', '0xb'], seated: fight, shared_pubsub: alice.pubsub })
  const intruder = create_player({ ...alice, address: '0xalice' })
  const owner = create_player({ ...bob, address: '0xbob' })
  const seen = () => bob.sent.filter(({ type }) => !['packet/server_info', 'packet/game_state'].includes(type))
  const named = (character_id: string, checkpoint: string) => [
    step(alice, character_id, 701, UNMOUNTED, checkpoint),
    chat('packet/chat', character_id, 'hello'),
    chat('packet/chat_party', character_id, 'party'),
    chat('packet/chat_whisper', character_id, 'psst', '0xbob'),
    ...['packet/spectate', 'packet/fight_preview', 'packet/fight_nearby'].map((type) =>
      JSON.stringify({ type, character_id, fight: '0xf1' })
    ),
  ]
  try {
    await settle(10)
    expect([intruder.online_characters().toSorted(), owner.online_characters().toSorted()]).toEqual([
      ['0xa', '0xa2'],
      ['0xb', '0xb2'],
    ])
    const before = {
      published: alice.published.length,
      reads: alice.reads.length,
      seen: seen().length,
      sent: alice.sent.length,
    }
    for (const raw of [
      ...named('0xb', bob.checkpoint('0xb')),
      ...named('0xb2', bob.checkpoint('0xb2')),
      JSON.stringify({
        type: 'packet/fight_action',
        fight: '0xf1',
        action: { type: 'move_to', fighter: '1', path: ['7'] },
      }),
      JSON.stringify({ type: 'packet/equip', character_id: '0xb', slot: 'hat', item: '0xi' }),
      JSON.stringify({ type: 'packet/gather', character_id: '0xb', zone: '0', pack: 1 }),
    ])
      intruder.on_message(raw)
    await Bun.sleep(60)
    await settle()
    // Nothing is published, nothing is read, the owner hears nothing, and only refusals come back.
    expect([alice.published.length, alice.reads.length, seen().length, alice.dropped]).toEqual([
      before.published,
      before.reads,
      before.seen,
      [],
    ])
    expect(
      alice.sent.slice(before.sent).map((packet) => (packet.type === 'packet/error' ? packet.reason : packet.type))
    ).toEqual(['not in this fight', 'unknown packet type "packet/equip"', 'unknown packet type "packet/gather"'])
    expect(owner.online_characters().toSorted()).toEqual(['0xb', '0xb2'])
    // The same packets naming its own characters act.
    intruder.on_message(step(alice, '0xa', 701))
    intruder.on_message(chat('packet/chat', '0xa', 'hello'))
    intruder.on_message(JSON.stringify({ type: 'packet/spectate', character_id: '0xa', fight: '0xf1' }))
    intruder.on_message(
      JSON.stringify({
        type: 'packet/fight_action',
        fight: '0xf1',
        action: { type: 'move_to', fighter: '0', path: ['7'] },
      })
    )
    await Bun.sleep(60)
    await settle()
    // Chat publishes after the sender's name resolves, so only the set is ordered here.
    expect(
      alice.published
        .slice(before.published)
        .map(({ channel }) => channel)
        .sort()
    ).toEqual(['act:fight:0xf1', 'chat:world:overworld', 'pos:overworld:1:0'])
    expect(types_of(seen().slice(before.seen))).toEqual(
      expect.arrayContaining(['packet/players_moved', 'packet/chat_message', 'packet/fight_action'])
    )
    expect(alice.reads.length).toBeGreaterThan(before.reads)
    await Bun.sleep(1_000)
    intruder.on_message(chat('packet/chat_whisper', '0xa', 'psst', '0xbob'))
    await settle()
    expect(seen().at(-1)).toMatchObject({ type: 'packet/chat_message', channel: 'whisper', from: '0xalice' })
  } finally {
    intruder.on_close()
    owner.on_close()
  }
})
