// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Redis } from 'ioredis'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { parse_client_packet, type AgentSetupRequest, type ServerPacket } from '@aresrpg/protocol'

import { create_pairing_exchange } from '../src/agent_pairing.ts'
import { prepare_agent_pairing } from '../../sdk/src/agent_signer.ts'
import { bootstrap_disposable_agent } from '../../sdk/examples/agent_bootstrap.ts'
import { bootstrap_setup_link } from '../../sdk/examples/agent_setup.ts'
import { serve_agent_setup } from '../src/agent_setup_http.ts'
import player_agent_setup from '../src/modules/player_agent_setup.ts'
import type { PlayerContext } from '../src/player.ts'
import { create_request_limiter } from '../src/request_limiter.ts'

import { create_player } from './helpers/player.ts'
import { wire } from './helpers/world_wire.ts'

let directory: string
let child: ChildProcess
let redis: Redis
let exchange: ReturnType<typeof create_pairing_exchange>
const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
const owner = google.toSuiAddress()
const other = `0x${'0'.repeat(64)}`
beforeAll(async () => {
  directory = await mkdtemp('/tmp/ares-pairing-exchange-')
  const socket = join(directory, 'redis.sock')
  child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Fixture Redis exited before readiness')))
    child.stdout!.on('data', (chunk) => {
      if (/ready to accept connections/i.test(String(chunk))) resolve()
    })
  })
  redis = new Redis(socket, { lazyConnect: true, retryStrategy: () => null })
  await redis.connect()
  exchange = create_pairing_exchange(redis)
})
afterAll(async () => {
  redis?.disconnect()
  if (child?.exitCode === null) {
    const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    await ended
  }
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('one capability exchanges only public proof and the owning game session reads the result', async () => {
  const link = await exchange.begin(owner, google.toBase64(), 10_000)
  expect(await exchange.status(owner, link.id)).toBeNull()
  await expect(exchange.status(other, link.id)).rejects.toThrow('PAIRING_UNAVAILABLE')
  await expect(exchange.setup(link.id, 'wrong')).rejects.toThrow('PAIRING_UNAVAILABLE')
  const request = await exchange.setup(link.id, link.token)
  const agent = await bootstrap_disposable_agent(request)
  const results = await Promise.allSettled([
    exchange.complete(link.id, link.token, agent.response),
    exchange.complete(link.id, link.token, agent.response),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect((await exchange.status(owner, link.id))?.address).toBe(agent.signer.address)
  await expect(exchange.complete(link.id, link.token, agent.response)).rejects.toThrow('PAIRING_ALREADY_COMPLETED')
  const stored = await redis.get(`agent-pairing:${link.id}`)
  expect(stored).not.toContain(link.token)
  expect(Object.keys(JSON.parse(stored!)).sort()).toEqual(['request', 'result', 'token_hash'])
  expect(await redis.pttl(`agent-pairing:${link.id}`)).toBeGreaterThan(0)
})

test('a proof for another request cannot complete this request; expired capabilities cannot revive it', async () => {
  const a = await exchange.begin(owner, google.toBase64(), 10_000)
  const b = await exchange.begin(owner, google.toBase64(), 10_000)
  const agent = await bootstrap_disposable_agent(await exchange.setup(a.id, a.token))
  await expect(exchange.complete(b.id, b.token, agent.response)).rejects.toThrow()
  expect(await exchange.status(owner, b.id)).toBeNull()
  await redis.pexpire(`agent-pairing:${a.id}`, 1)
  await Bun.sleep(10)
  await expect(exchange.complete(a.id, a.token, agent.response)).rejects.toThrow('PAIRING_UNAVAILABLE')
  await expect(exchange.status(owner, a.id)).rejects.toThrow('PAIRING_UNAVAILABLE')
  await expect(exchange.begin(other, google.toBase64(), 1000)).rejects.toThrow()
  await expect(exchange.begin(owner, google.toBase64(), 0)).rejects.toThrow('INVALID_PAIRING_LIFETIME')
})

test('authenticated session creates one setup link; HTTP client returns proof and session detects completion', async () => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const sent: ServerPacket[] = []
  player_agent_setup.observe({
    address: owner,
    agent_pairing: exchange,
    events,
    signal: controller.signal,
    send: (packet: ServerPacket) => {
      sent.push(packet)
    },
  } as PlayerContext)
  const send = async (id: number, request: unknown) => {
    const packet = parse_client_packet(JSON.stringify({ type: 'packet/agent_setup_request', id, request }))
    events.emit(packet.type, packet)
    for (let attempt = 0; attempt < 100 && !sent.some((packet) => 'id' in packet && packet.id === id); attempt++)
      await Bun.sleep(5)
    const reply = sent.find((packet) => 'id' in packet && packet.id === id)
    if (reply?.type !== 'packet/agent_setup_response') throw Error('No pairing reply')
    return reply.result
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 64 * 1024,
    fetch: (request) => serve_agent_setup(request, exchange),
  })
  try {
    expect(() =>
      parse_client_packet(
        JSON.stringify({
          type: 'packet/agent_setup_request',
          id: 0,
          request: { action: 'begin', public_identifier: google.toBase64(), owner: other },
        })
      )
    ).toThrow()
    const begun = await send(1, { action: 'begin', public_identifier: google.toBase64() })
    if (begun.action !== 'begin') throw Error('No setup link')
    const link = `http://127.0.0.1:${server.port}/api/agent-setup?id=${begun.pairing_id}#${begun.token}`
    const instructions = await fetch(link).then((response) => response.text())
    expect(instructions).toBe('Setup guide: https://aresrpg.world/agents/client.txt\n')
    expect(instructions).not.toContain(begun.token)
    const signer = await bootstrap_setup_link(link, { fetch })
    const { verify_login } = await import('../src/auth.ts')
    const uuid = crypto.randomUUID()
    const proof = await signer.sign_personal_message(new TextEncoder().encode(`aresrpg::${uuid}`))
    expect(await verify_login({ ...proof, uuid, address: signer.address })).toBe(true)
    await expect(exchange.cancel(other, begun.pairing_id)).rejects.toThrow('PAIRING_UNAVAILABLE')
    expect(await send(2, { action: 'status', pairing_id: begun.pairing_id })).toEqual({
      action: 'status',
      identity: {
        address: signer.address,
        multisig_public_key: signer.public_key.toBase64(),
        signer_mode: 'disposable',
      },
    })
    await expect(bootstrap_setup_link(link, { fetch })).rejects.toThrow('SETUP_COMPLETION_FAILED')
    expect(await send(3, { action: 'cancel', pairing_id: begun.pairing_id })).toEqual({ action: 'cancel' })
    expect(await send(4, { action: 'status', pairing_id: begun.pairing_id })).toEqual({
      action: 'error',
      error: 'unavailable',
    })
  } finally {
    controller.abort()
    server.stop(true)
  }
})

test('concurrent completion cannot survive acknowledged owner cancellation', async () => {
  const link = await exchange.begin(owner, google.toBase64(), 10_000)
  const agent = await bootstrap_disposable_agent(await exchange.setup(link.id, link.token))
  const results = await Promise.allSettled([
    exchange.complete(link.id, link.token, agent.response),
    exchange.cancel(owner, link.id),
  ])
  expect(results[1]?.status).toBe('fulfilled')
  await expect(exchange.status(owner, link.id)).rejects.toThrow('PAIRING_UNAVAILABLE')
  await expect(exchange.complete(link.id, link.token, agent.response)).rejects.toThrow('PAIRING_UNAVAILABLE')
})

const setup_reply = async (sent: ServerPacket[], id: number) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const packet = sent.find((packet) => packet.type === 'packet/agent_setup_response' && packet.id === id)
    if (packet?.type === 'packet/agent_setup_response') return packet.result
    await Bun.sleep(5)
  }
  throw new Error('No setup reply')
}

test('player boundary cancels during pending status with its shared read allowance exhausted', async () => {
  const link = await exchange.begin(owner, google.toBase64(), 10_000)
  const status = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const wires = wire({ character_ids: [] })
  const player = create_player({
    ...wires,
    address: owner,
    admin: false,
    request_limiter: create_request_limiter({ capacity: 1 }),
    agent_pairing: {
      ...exchange,
      request: async (address, input) => {
        if (input.action === 'status') {
          started.resolve()
          await status.promise
        }
        return exchange.request(address, input)
      },
    },
  })
  const send = (id: number, request: AgentSetupRequest) =>
    player.on_message(JSON.stringify({ type: 'packet/agent_setup_request', id, request }))
  try {
    send(1, { action: 'status', pairing_id: link.id })
    await started.promise
    send(2, { action: 'begin', public_identifier: google.toBase64() })
    expect(wires.sent).toContainEqual({ type: 'packet/error', id: 2, reason: 'rate limited' })
    send(3, { action: 'cancel', pairing_id: link.id })
    expect(await setup_reply(wires.sent, 3)).toEqual({ action: 'cancel' })
    await expect(exchange.setup(link.id, link.token)).rejects.toThrow('PAIRING_UNAVAILABLE')
    status.resolve()
    expect(await setup_reply(wires.sent, 1)).toEqual({ action: 'error', error: 'unavailable' })
    send(4, { action: 'status', pairing_id: link.id })
    expect(wires.sent).toContainEqual({ type: 'packet/error', id: 4, reason: 'rate limited' })
  } finally {
    status.resolve()
    player.on_close()
  }
})

test('account replacement cannot cancel another owner; admitted old cancellation survives socket close without late replies', async () => {
  const link = await exchange.begin(owner, google.toBase64(), 10_000)
  const release = Promise.withResolvers<void>()
  const status_started = Promise.withResolvers<void>()
  const cancel_started = Promise.withResolvers<void>()
  const cancelled = Promise.withResolvers<void>()
  const old_wires = wire({ character_ids: [] })
  const old = create_player({
    ...old_wires,
    address: owner,
    admin: false,
    agent_pairing: {
      ...exchange,
      request: async (address, input) => {
        if (input.action === 'status') status_started.resolve()
        if (input.action === 'cancel') cancel_started.resolve()
        await release.promise
        const result = await exchange.request(address, input)
        if (input.action === 'cancel') cancelled.resolve()
        return result
      },
    },
  })
  const next_wires = wire({ character_ids: [] })
  const next = create_player({ ...next_wires, address: other, admin: false, agent_pairing: exchange })
  const send = (player: typeof old, id: number, action: 'status' | 'cancel') =>
    player.on_message(
      JSON.stringify({ type: 'packet/agent_setup_request', id, request: { action, pairing_id: link.id } })
    )
  try {
    send(old, 1, 'status')
    await status_started.promise
    send(old, 2, 'cancel')
    await cancel_started.promise
    old.on_close()
    send(next, 3, 'status')
    expect(await setup_reply(next_wires.sent, 3)).toEqual({ action: 'error', error: 'unavailable' })
    send(next, 4, 'cancel')
    expect(await setup_reply(next_wires.sent, 4)).toEqual({ action: 'error', error: 'unavailable' })
    expect((await exchange.setup(link.id, link.token)).owner).toBe(owner)
    release.resolve()
    await cancelled.promise
    await expect(exchange.setup(link.id, link.token)).rejects.toThrow('PAIRING_UNAVAILABLE')
    expect(old_wires.sent.filter((packet) => packet.type === 'packet/agent_setup_response')).toEqual([])
  } finally {
    release.resolve()
    old.on_close()
    next.on_close()
  }
})

test('server status preserves the signed persistent-mode declaration and public identity', async () => {
  const link = await exchange.begin(owner, google.toBase64(), 5_000)
  const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const client = await prepare_agent_pairing(await exchange.setup(link.id, link.token), {
    storage: 'persistent',
    public_key: keypair.getPublicKey(),
    sign_personal_message: (bytes) => keypair.signPersonalMessage(bytes),
    sign_transaction: (bytes) => keypair.signTransaction(bytes),
  })
  await exchange.complete(link.id, link.token, client.response)
  expect(await exchange.request(owner, { action: 'status', pairing_id: link.id })).toEqual({
    action: 'status',
    identity: {
      address: client.signer.address,
      multisig_public_key: client.signer.public_key.toBase64(),
      signer_mode: 'host-persistent',
    },
  })
  await exchange.cancel(owner, link.id)
})
