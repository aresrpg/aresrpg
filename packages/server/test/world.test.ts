// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_player } from '../src/player.ts'

import { wire, make_character, flush } from './helpers/world_wire.ts'

describe('the world module', () => {
  test('party membership is reread after the character channel becomes ready', async () => {
    const { sent, ws, graph, pubsub } = wire({ party_after_watch: true, character_ids: ['0xabc'] })
    create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await flush()
    await flush()
    expect(
      sent.filter((packet) => packet.type === 'packet/party' && packet.character_id === '0xabc').at(-1)
    ).toMatchObject({ party: { id: '0xp' } })
  })

  test('embody mounts the spiral and pushes zones + an appearance on the mesh', async () => {
    const { sent, ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    expect(sent.some((packet) => packet.type === 'packet/tracked_zones' && packet.character_id === '0xabc')).toBeTrue()
    expect(sent.some((packet) => packet.type === 'packet/zones')).toBe(true)
    expect(published.some(({ payload }) => payload.kind === 'appear')).toBe(true)
  })

  test('tracks and moves two owned characters without replacing either window or anchor', async () => {
    const { sent, ws, graph, pubsub, published, dropped, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xdef', tracked: true }))
    await flush()
    await flush()

    expect(
      sent.flatMap((packet) => (packet.type === 'packet/tracked_zones' ? [packet.character_id] : [])).sort()
    ).toEqual(['0xabc', '0xdef'])
    expect(
      sent.flatMap((packet) => (packet.type === 'packet/tracked_zones' ? [packet.character_id] : [])).sort()
    ).toEqual(['0xabc', '0xdef'])

    published.length = 0
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xdef',
        checkpoint: checkpoint('0xdef'),
        x: 701,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(dropped).toEqual([])
    expect(published.some(({ payload }) => payload.kind === 'move' && payload.character_id === '0xdef')).toBeTrue()

    published.length = 0
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xdef', tracked: false }))
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xdef',
        checkpoint: checkpoint('0xdef'),
        x: 702,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(published.some(({ payload }) => payload.kind === 'move' && payload.character_id === '0xdef')).toBeTrue()
  })

  test('a fighting character keeps its zone window but leaves world presence immediately', async () => {
    const { ws, graph, pubsub, published, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await flush()
    published.length = 0

    player.dispatch({ type: 'action/fight', character_id: '0xdef', fight: '0xfight', seat: 0 })
    expect(published.some(({ payload }) => payload.kind === 'leave' && payload.character_id === '0xdef')).toBeTrue()

    published.length = 0
    pubsub.emitter.emit('pos:overworld:1:0', {
      kind: 'who',
      address: '0xother',
      world: 'overworld',
      zx: 1,
      zz: 0,
    })
    expect(
      published.some(({ payload }) => payload.kind === 'appear' && payload.player?.character_id === '0xdef')
    ).toBeFalse()

    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xdef',
        checkpoint: checkpoint('0xdef'),
        x: 701,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(published.some(({ payload }) => payload.kind === 'move' && payload.character_id === '0xdef')).toBeFalse()
  })

  test('a dungeon character leaves world presence, ignores movement, and receives only its lobby', async () => {
    const dungeon_run = '{"dungeon":"tangled_aftermath","room":"1","seed":"9"}'
    const { sent, ws, graph, pubsub, published, dropped, checkpoint } = wire({ dungeon_run, character_ids: ['0xabc'] })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    await flush()

    expect(sent.some(({ type }) => type === 'packet/tracked_zones')).toBeFalse()
    expect(sent).toContainEqual({
      type: 'packet/dungeon_lobby',
      lobby: {
        dungeon: 'tangled_aftermath',
        players: [{ character_id: '0xabc', name: 'nox', level: 10, room: 1 }],
        fights: [],
      },
    })
    pubsub.emitter.emit('evt:dungeon:tangled_aftermath', {
      ckpt: 2,
      tx: 0,
      evt: 0,
      ts_ms: Date.now(),
      type: 'DungeonLobbyChanged',
      data: { world: 'overworld', x: 120, z: 140 },
    })
    await flush()
    expect(sent.filter(({ type }) => type === 'packet/dungeon_lobby')).toHaveLength(2)
    published.length = 0
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 130,
        y: 0,
        z: 140,
        riding: false,
      })
    )
    expect(published).toEqual([])
    expect(dropped).toEqual([])
  })

  test('two accounts receive each other symmetrically across presence, movement, and world chat', async () => {
    const first = wire({ character_ids: ['0xa'] })
    const first_player = create_player({
      ws: first.ws,
      address: '0xfirst',
      admin: false,
      graph: first.graph,
      pubsub: first.pubsub,
    })
    await flush()
    await flush()
    const second = wire({ character_ids: ['0xb'], shared_pubsub: first.pubsub })
    const second_player = create_player({
      ws: second.ws,
      address: '0xsecond',
      admin: false,
      graph: second.graph,
      pubsub: second.pubsub,
    })
    await flush()
    await flush()

    expect(
      first.sent.some((packet) => packet.type === 'packet/player_appeared' && packet.player.character_id === '0xb')
    ).toBeTrue()
    expect(
      second.sent.some((packet) => packet.type === 'packet/player_appeared' && packet.player.character_id === '0xa')
    ).toBeTrue()

    second_player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xb',
        checkpoint: second.checkpoint('0xb'),
        x: 101,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(
      first.sent.some((packet) => packet.type === 'packet/player_moved' && packet.character_id === '0xb')
    ).toBeTrue()

    second_player.on_message(
      JSON.stringify({ type: 'packet/chat', character_id: '0xb', parts: [{ kind: 'text', text: 'hello' }] })
    )
    await flush()
    const chat = first.sent.find((packet) => packet.type === 'packet/chat_message' && packet.character === 'nox')
    expect(chat).toMatchObject({ parts: [{ kind: 'text', text: 'hello' }] })
    void first_player
  })

  test('a duplicate client tracking request cannot remount an already server-tracked character', async () => {
    const { ws, graph, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    await flush()
    published.length = 0
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    expect(published).toHaveLength(0)
    await flush()
    expect(published).toHaveLength(0)
  })

  test("a position carrying another character's id is never priced against the current anchor", async () => {
    const { ws, graph, pubsub, published, dropped, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xother',
        checkpoint: checkpoint('0xother'),
        x: 10_000,
        y: 0,
        z: 10_000,
        riding: false,
      })
    )

    expect(dropped).toEqual([])
    expect(published.some(({ payload }) => payload.kind === 'move')).toBeFalse()
    await flush()
  })

  test('a character outside the capped roster remains completely invisible to tracking requests', async () => {
    const { sent, ws, graph, pubsub, published } = wire({ owns: false })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xdead', tracked: true }))
    await flush()
    expect(sent.find((packet) => packet.type === 'packet/tracked_zones')).toBeUndefined()
    expect(published.some(({ payload }) => payload.kind === 'appear')).toBe(false)
  })

  test('mounting while standing still publishes — and a petless riding claim is clamped', async () => {
    // owner 2026-08-21: mount/dismount rides the position stream, so a toggle with ZERO
    // displacement must still reach the zone (the old "refit, not a move" gate ate it).
    const rider = wire({ pet: true })
    const mounted = create_player({
      ws: rider.ws,
      address: '0xme',
      admin: false,
      graph: rider.graph,
      pubsub: rider.pubsub,
    })
    await flush()
    mounted.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    const before = rider.published.length
    mounted.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: rider.checkpoint('0xabc'),
        x: 100,
        y: 0,
        z: 100,
        riding: true,
      })
    )
    const toggle = rider.published.slice(before).filter(({ payload }) => payload.kind === 'move')
    expect(toggle).toHaveLength(1)
    expect(toggle[0]!.payload.riding).toBe(true)

    // no pet equipped: the claim is a lie and the server clamps it to false
    const walker = wire()
    const walking = create_player({
      ws: walker.ws,
      address: '0xme',
      admin: false,
      graph: walker.graph,
      pubsub: walker.pubsub,
    })
    await flush()
    walking.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    walking.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: walker.checkpoint('0xabc'),
        x: 101,
        y: 0,
        z: 100,
        riding: true,
      })
    )
    const claimed = walker.published.filter(({ payload }) => payload.kind === 'move')
    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.payload.riding).toBe(false)
  })

  test('an impossible move drops the connection', async () => {
    const { ws, graph, pubsub, dropped, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    // The FIRST move prices against the CHECKPOINT'S OWN TIMESTAMP (the chain's travel_ok
    // semantics): a player who walked 500 blocks off-anchor since a 60s-old checkpoint is
    // LEGAL (500/60 ≈ 8.3 b/s) — the 2026-08-19 bug priced it against embody wall-clock and
    // drop-looped every session into load-snapshot spam.
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 600,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(dropped).toEqual([])
    // 10,000 further blocks in one tick — far past any authored budget
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 10600,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(dropped).toEqual(['SPEED'])
  })

  test('a buffered burst of legal steps spends the banked budget instead of dropping', async () => {
    // 2026-08-20 production drop: a network stall flushed queued positions in ONE millisecond;
    // the old law re-anchored on the first and priced the rest against a zero-second window
    // (`elapsed_s: 0`), so 3.2 blocks of ordinary walking read as infinite speed.
    const { ws, graph, pubsub, dropped, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 600,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    // six buffered samples land back-to-back, one block apart — 6 blocks in ~0ms, all legal
    for (let step = 1; step <= 6; step++)
      player.on_message(
        JSON.stringify({
          type: 'packet/position',
          character_id: '0xabc',
          checkpoint: checkpoint('0xabc'),
          x: 600 + step,
          y: 0,
          z: 100,
          riding: false,
        })
      )
    expect(dropped).toEqual([])
    // the bank is finite: a same-instant TELEPORT still overdraws it
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 700,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(dropped).toEqual(['SPEED'])
  })

  test('the speed ceiling is the AUTHORED one — mounted passes what unmounted drops', async () => {
    // 14 blocks in ~1s: above 11.5 (walk), below 17.25 (mounted)
    const walker = wire()
    const walking = create_player({
      ws: walker.ws,
      address: '0xme',
      admin: false,
      graph: walker.graph,
      pubsub: walker.pubsub,
    })
    await flush()
    walking.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    // 850 blocks over the checkpoint's 60s budget: ~14.2 b/s — above 11.5 (walk), below
    // 17.25 (mounted). The budget prices distance-from-anchor over elapsed-since-anchor.
    walking.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: walker.checkpoint('0xabc'),
        x: 950,
        y: 0,
        z: 100,
        riding: false,
      })
    )
    expect(walker.dropped).toEqual(['SPEED'])

    const rider = wire({ pet: true })
    const riding = create_player({
      ws: rider.ws,
      address: '0xme',
      admin: false,
      graph: rider.graph,
      pubsub: rider.pubsub,
    })
    await flush()
    riding.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    riding.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: rider.checkpoint('0xabc'),
        x: 950,
        y: 0,
        z: 100,
        riding: true,
      })
    )
    expect(rider.dropped).toEqual([])
  })

  test('visibility caps at 100 strangers — friends ALWAYS pass', async () => {
    const { sent, ws, graph, pubsub } = wire({ friends: ['0xbestie'] })
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    const appear = (index: number, address: string) =>
      pubsub.emitter.emit('pos:overworld:0:0', {
        kind: 'appear',
        address,
        player: {
          character_id: `0xp${index}`,
          name: `p${index}`,
          classe: 'senshi',
          sex: 'male',
          level: 1,
          color_1: 0,
          color_2: 0,
          color_3: 0,
          pet: false,
          x: 100,
          y: 0,
          z: 100,
        },
      })
    for (let index = 0; index < 120; index++) appear(index, `0xstranger${index}`)
    appear(999, '0xbestie') // the friend arrives past the cap
    const appeared = sent.filter((packet) => packet.type === 'packet/player_appeared')
    expect(appeared).toHaveLength(101) // 100 strangers + the friend
    // a NEAR uncapped stranger's move flows; a capped one's is silent
    pubsub.emitter.emit('pos:overworld:0:0', {
      kind: 'move',
      character_id: '0xp5',
      address: '0xstranger5',
      x: 105,
      y: 0,
      z: 105,
    })
    pubsub.emitter.emit('pos:overworld:0:0', {
      kind: 'move',
      character_id: '0xp115',
      address: '0xstranger115',
      x: 105,
      y: 0,
      z: 105,
    })
    const moves = sent.filter((packet) => packet.type === 'packet/player_moved')
    expect(moves.map((move) => (move as { character_id: string }).character_id)).toEqual(['0xp5'])
    // a FAR player's moves throttle to 1-in-4 (legacy tuning: >100 blocks skips 3)
    for (let step = 0; step < 4; step++)
      pubsub.emitter.emit('pos:overworld:0:0', {
        kind: 'move',
        character_id: '0xp6',
        address: '0xstranger6',
        x: 300 + step,
        y: 0,
        z: 300,
      })
    const far_moves = sent.filter(
      (packet) => packet.type === 'packet/player_moved' && (packet as { character_id: string }).character_id === '0xp6'
    )
    expect(far_moves).toHaveLength(1)
    expect((far_moves[0] as { x: number }).x).toBe(303)
  })

  test('crossing a zone retires players from the departed subscription window', async () => {
    const { sent, ws, graph, pubsub } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    pubsub.emitter.emit('pos:overworld:-1:0', {
      kind: 'appear',
      address: '0xold',
      player: {
        ...make_character().properties,
        character_id: '0xold',
        owner: '0xold',
        x: -100,
        riding: false,
        y: 0,
      },
    })
    expect(sent.some((packet) => packet.type === 'packet/player_appeared')).toBe(true)

    player.dispatch({
      type: 'action/move',
      character_id: '0xabc',
      x: 600,
      y: 0,
      z: 100,
      riding: false,
      at_ms: Date.now(),
      budget_blocks: 0,
    })
    await flush()
    expect(sent.some((packet) => packet.type === 'packet/player_left' && packet.character_id === '0xold')).toBe(true)
  })

  test('a later joiner probes tracked zones and a standing player re-announces to it', async () => {
    const { graph, ws, pubsub, published } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    const probes = published.filter(({ payload }) => payload.kind === 'who')
    expect(probes.length).toBeGreaterThan(0)
    published.length = 0
    // someone else probes MY zone — I stand there, so I re-announce myself
    pubsub.emitter.emit('pos:overworld:0:0', { kind: 'who', address: '0xlater', world: 'overworld', zx: 0, zz: 0 })
    const announces = published.filter(({ payload }) => payload.kind === 'appear')
    expect(announces).toHaveLength(1)
    // the other owned character stands in zone 1 and answers even while not selected
    published.length = 0
    pubsub.emitter.emit('pos:overworld:0:0', { kind: 'who', address: '0xlater', world: 'overworld', zx: 1, zz: 0 })
    expect(published.filter(({ payload }) => payload.kind === 'appear')).toHaveLength(1)
  })

  test('a plausible move within the zone publishes a move fact, not a re-track', async () => {
    const { graph, ws, pubsub, published, checkpoint } = wire()
    const player = create_player({ ws, address: '0xme', admin: false, graph, pubsub })
    await flush()
    player.on_message(JSON.stringify({ type: 'packet/track_character', character_id: '0xabc', tracked: true }))
    await flush()
    published.length = 0
    player.on_message(
      JSON.stringify({
        type: 'packet/position',
        character_id: '0xabc',
        checkpoint: checkpoint('0xabc'),
        x: 100.3,
        y: 0,
        z: 100.3,
        riding: false,
      })
    )
    expect(published.every(({ payload }) => payload.kind === 'move')).toBe(true)
  })
})
