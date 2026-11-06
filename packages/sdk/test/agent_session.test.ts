// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn as spy_on, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_agent_connection, type AgentSocket } from '../src/agent_connection.ts'
import { create_agent_multisig } from '../src/agent_multisig.ts'
import { create_bun_agent_transport } from '../examples/agent_transport.ts'
import { create_agent_run } from '../examples/agent_kit.ts'

const wait_for = async (predicate: () => boolean) => {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
  expect(predicate()).toBe(true)
}

const load_runtime = async () => {
  const [auth, admission, connection, player, fixtures] = await Promise.all([
    import(new URL('../../server/src/auth.ts', import.meta.url).href),
    import(new URL('../../server/src/admission.ts', import.meta.url).href),
    import(new URL('../../server/src/connection.ts', import.meta.url).href),
    import(new URL('../../server/test/helpers/player.ts', import.meta.url).href),
    import(new URL('../../server/test/helpers/stream_wire.ts', import.meta.url).href),
  ])
  return { ...auth, ...admission, ...connection, ...player, ...fixtures }
}

// No live chain ownership: only these address-scoped graph rows and this in-memory bus are fixtures.
// The server's authentication, player reducers, projections, ownership check and fight relay are real.
const fixture_world = (
  runtime: Awaited<ReturnType<typeof load_runtime>>,
  address: string,
  fight_id: string,
  character_id = '0xabc'
) => {
  let owned = true
  const { pubsub, published } = runtime.wire()
  const fight = structuredClone(runtime.fight_node)
  fight.properties.id = fight_id
  fight.properties.machine = fight.properties.machine.replaceAll('0xme', address).replaceAll(character_id, character_id)
  const character = {
    properties: {
      id: character_id,
      owner: address,
      name: 'fixture',
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
    },
  }
  const queries: { cypher: string; params?: Record<string, unknown> }[] = []
  const graph = {
    read: async (cypher: string, params: Record<string, unknown> = {}) => {
      queries.push({ cypher, params })
      if (
        ![
          owned,
          [undefined, address].includes(params.address as string | undefined),
          [undefined, character_id].includes(params.character_id as string | undefined),
          [undefined, fight_id].includes(params.fight_id as string | undefined),
        ].every(Boolean)
      )
        return []
      if (cypher.includes(':FIGHTER]->(c:Character {owner:'))
        return [
          {
            character,
            kiosk_node: { properties: { id: '0xk' } },
            equipment: [],
            active_fight: { id: fight_id, seat: 0 },
          },
        ]
      if (cypher.includes(':Character {id:'))
        return [{ character, held_kiosk: null, kiosk: '0xk', fight, party: null, worn: [] }]
      if (cypher.includes(':Fight {id:')) return [{ fight }]
      if (cypher.includes('WHERE c.id IN')) return [{ character, weapon: null, worn: [] }]
      return []
    },
    close: async () => {},
  }
  return {
    graph,
    pubsub,
    published,
    queries,
    revoke: () => {
      owned = false
      pubsub.emitter.emit(`evt:social:${address}`, {
        type: 'CharacterHeld',
        data: { character: character_id, kiosk: '0xother' },
      })
    },
  }
}

const serve_session = (runtime: Awaited<ReturnType<typeof load_runtime>>, world: ReturnType<typeof fixture_world>) => {
  const pending = runtime.create_pending_admission()
  const handlers = new Map<unknown, { on_message: (raw: string | Buffer) => Promise<void>; on_close: () => void }>()
  const packets: ServerPacket[] = []
  const inbound: string[] = []
  const addresses: string[] = []
  const server = Bun.serve<{ address: string; release: () => void }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      const release = pending.reserve()
      if (!release) return new Response('full', { status: 503 })
      const address = new URL(request.url).searchParams.get('address') ?? ''
      if (listener.upgrade(request, { data: { address, release } })) return
      release()
      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      open(ws) {
        const send = (packet: ServerPacket) => {
          packets.push(packet)
          ws.send(JSON.stringify(packet))
        }
        handlers.set(
          ws,
          runtime.create_authenticated_connection({
            address: ws.data.address,
            release_pending: ws.data.release,
            send,
            close: (code: number, reason: string) => ws.close(code, reason),
            verify: runtime.verify_login,
            promote: () => {
              addresses.push(ws.data.address)
              return runtime.create_player({
                address: ws.data.address,
                admin: false,
                graph: world.graph,
                pubsub: world.pubsub,
                ws: {
                  send: (raw: string) => send(JSON.parse(raw)),
                  close: (code: number, reason: string) => ws.close(code, reason),
                },
              })
            },
          })
        )
      },
      message(ws, raw) {
        inbound.push(JSON.parse(String(raw)).type)
        void handlers.get(ws)?.on_message(raw)
      },
      close(ws) {
        handlers.get(ws)?.on_close()
        handlers.delete(ws)
      },
    },
  })
  return { server, pending, handlers, packets, addresses, inbound, endpoint: `ws://127.0.0.1:${server.port}` }
}

test('real player projects scoped fixture custody, resyncs owned fight and revokes authority across reconnect', async () => {
  const runtime = await load_runtime()
  const keypair = new Ed25519Keypair()
  const signer = create_agent_multisig({
    agent_public_key: keypair.getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
    sign_personal_message: (message) => keypair.signPersonalMessage(message),
  })
  const fight_id = `0x${'1'.repeat(64)}`
  const foreign_fight = `0x${'2'.repeat(64)}`
  const world = fixture_world(runtime, signer.address, fight_id)
  const fixture = serve_session(runtime, world)
  const network = spy_on(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () => {
        throw new Error('External fetch forbidden')
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  )
  const received: ServerPacket[] = []
  let socket: AgentSocket | undefined
  const transport = create_bun_agent_transport()
  const connection = create_agent_connection({
    endpoint: fixture.endpoint,
    origin: 'http://localhost:5173',
    signer,
    transport: {
      open: (url, handlers) => {
        socket = transport.open(url, {
          ...handlers,
          on_message: async (raw) => {
            await handlers.on_message(raw)
            received.push(JSON.parse(raw))
          },
        })
        return socket
      },
    },
  })
  const fight_states = () => received.filter(({ type }) => type === 'packet/fight_state').length
  const refusals = () =>
    received.filter((packet) => packet.type === 'packet/error' && packet.reason === 'not in this fight').length
  try {
    connection.connect()
    // Roster readiness precedes tracking; wait for an actual received fight snapshot.
    await wait_for(() => connection.state().status === 'ready' && fight_states() > 0)
    expect(connection.state().characters).toMatchObject([
      { id: '0xabc', custody: 'fight', active_fight: { id: fight_id, seat: 0 } },
    ])
    expect(fixture.addresses).toEqual([signer.address])
    expect(
      world.queries
        .filter(({ params }) => params && 'address' in params)
        .every(({ params }) => params!.address === signer.address)
    ).toBe(true)
    expect(
      world.queries.some(
        ({ cypher, params }) =>
          cypher.includes('held_kiosk.id AS held_kiosk') &&
          params?.address === signer.address &&
          params.character_id === '0xabc'
      )
    ).toBe(true)
    const roster_query = world.queries.find(({ cypher }) => cypher.includes(':FIGHTER]->(c:Character {owner:'))!
    expect(await world.graph.read(roster_query.cypher, { address: `0x${'3'.repeat(64)}` })).toEqual([])

    expect(connection.request_fight_resync(foreign_fight)).toBe(false)
    const before = fight_states()
    expect(connection.request_fight_resync(fight_id)).toBe(true)
    await wait_for(() => fight_states() > before)
    expect(
      world.published.some(
        ({ channel, payload }: { channel: string; payload: { kind: string; address: string } }) =>
          channel === `act:fight:${fight_id}` && payload.kind === 'resync' && payload.address === signer.address
      )
    ).toBe(true)

    socket!.send(JSON.stringify({ type: 'packet/fight_resync', fight: foreign_fight }))
    await wait_for(() => refusals() === 1)
    world.revoke()
    await wait_for(() => connection.state().characters.length === 0)
    expect(connection.request_fight_resync(fight_id)).toBe(false)
    socket!.send(JSON.stringify({ type: 'packet/fight_resync', fight: fight_id }))
    await wait_for(() => refusals() === 2)

    connection.disconnect()
    connection.reconnect()
    expect(connection.state().characters).toEqual([])
    await wait_for(() => connection.state().status === 'ready' && fixture.addresses.length === 2)
    expect(connection.state().characters).toEqual([])
    expect(connection.request_fight_resync(fight_id)).toBe(false)
    expect(fixture.pending.size()).toBe(0)
    expect(network).not.toHaveBeenCalled()
  } finally {
    connection.stop()
    void fixture.server.stop(true)
    network.mockRestore()
  }
  await wait_for(() => fixture.handlers.size === 0)
}, 10000)

test('agent kit observes a real authenticated player session and stops on fixture custody loss', async () => {
  const runtime = await load_runtime()
  const keypair = new Ed25519Keypair()
  const signer = create_agent_multisig({
    agent_public_key: keypair.getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
    sign_personal_message: (message) => keypair.signPersonalMessage(message),
  })
  const character_id = `0x${'4'.repeat(64)}`
  const world = fixture_world(runtime, signer.address, `0x${'5'.repeat(64)}`, character_id)
  const fixture = serve_session(runtime, world)
  const network = spy_on(globalThis, 'fetch').mockImplementation(
    Object.assign(
      () => {
        throw new Error('External fetch forbidden')
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  )
  const run = create_agent_run(
    {
      version: 1,
      strategy: 'observe',
      objective: 'Observe fixture custody',
      endpoint: fixture.endpoint,
      origin: 'http://localhost:5173',
      character_ids: [character_id],
      duration_ms: 3000,
      max_spend_mist: '0',
    },
    { signer, transport: create_bun_agent_transport() }
  )
  try {
    await wait_for(() => run.status().status === 'ready')
    expect(run.status().character_ids).toEqual([character_id])
    expect(fixture.addresses).toEqual([signer.address])
    world.revoke()
    expect((await run.done).reason).toBe('character_missing')
    expect(fixture.inbound).toEqual(['packet/signature_response'])
    expect(network).not.toHaveBeenCalled()
  } finally {
    run.stop()
    void fixture.server.stop(true)
    network.mockRestore()
  }
  await wait_for(() => fixture.handlers.size === 0)
  expect(fixture.pending.size()).toBe(0)
}, 5000)
