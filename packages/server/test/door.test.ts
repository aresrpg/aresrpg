// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one door: the login proof, the claim an upgrade URL fixes, and the real `src/index.ts` over real
// sockets with its budgets, its seat map and its cool-off.

import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'
import * as signature_verification from '@mysten/sui/verify'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_admission_slots } from '../src/admission.ts'
import { verify_login } from '../src/auth.ts'
import { create_ban_list } from '../src/ban_list.ts'
import { create_connection, read_claim } from '../src/connection.ts'

const ORIGIN = 'http://localhost:5173'
const MAX_VIEWERS = 68
const MAX_PLAYERS = 3
const address = (digit: string) => `0x${digit.repeat(64)}`
const proof = JSON.stringify({ type: 'packet/signature_response', bytes: 'bytes', signature: 'signature' })

const free_port = (): number => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
  const { port } = probe
  void probe.stop(true)
  return port!
}
const port = free_port()
const child = Bun.spawn([process.execPath, new URL('./door_fixture.ts', import.meta.url).pathname], {
  env: {
    ...process.env,
    PORT: String(port),
    MAX_VIEWERS: String(MAX_VIEWERS),
    MAX_PLAYERS: String(MAX_PLAYERS),
    LOG_LEVEL: 'silent',
  },
  stdout: 'ignore',
  stderr: 'pipe',
})

beforeAll(async () => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ready = await fetch(`http://127.0.0.1:${port}/health`).then(
      (response) => response.ok,
      () => false
    )
    if (ready) return
    await Bun.sleep(25)
  }
  child.kill()
  throw new Error(`door fixture never listened: ${await new Response(child.stderr).text()}`)
})
afterAll(() => {
  child.kill()
})

type Ask = Readonly<{ address?: string; seat?: boolean }>
type Client = Readonly<{
  ws: WebSocket
  packets: ServerPacket[]
  closed: Promise<Readonly<{ code: number; reason: string }>>
  next: (type: ServerPacket['type']) => Promise<ServerPacket>
}>
const query = (claim: Ask) =>
  new URLSearchParams({
    ...(claim.address ? { address: claim.address } : {}),
    ...(claim.seat ? { seat: '1' } : {}),
  }).toString()

const connect = (claim: Ask, visitor: string): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?${query(claim)}`, {
      headers: { origin: ORIGIN, 'cf-connecting-ip': visitor },
    } as never)
    const packets: ServerPacket[] = []
    const waiting = new Set<() => void>()
    ws.onmessage = (event) => {
      packets.push(JSON.parse(String(event.data)) as ServerPacket)
      waiting.forEach((wake) => wake())
    }
    const closed = new Promise<Readonly<{ code: number; reason: string }>>((done) => {
      ws.onclose = ({ code, reason }) => done({ code, reason })
    })
    const next = (type: ServerPacket['type']) =>
      new Promise<ServerPacket>((done) => {
        const check = () => {
          const found = packets.find((packet) => packet.type === type)
          if (!found) return
          waiting.delete(check)
          done(found)
        }
        waiting.add(check)
        check()
      })
    ws.onopen = () => resolve({ ws, packets, closed, next })
    ws.onerror = () => reject(new Error('upgrade refused'))
  })

/** Open a socket and walk its stage's admission to `connection_accepted`. */
const admit = async (claim: Ask, visitor: string): Promise<Client> => {
  const client = await connect(claim, visitor)
  if (claim.address) {
    await client.next('packet/signature_request')
    client.ws.send(proof)
  }
  await client.next('packet/connection_accepted')
  return client
}
/** A plain request on the socket path: 503 when a budget refuses it, 500 when admitted but not an upgrade. */
const knock = async (claim: Ask, visitor: string, origin = ORIGIN): Promise<number> => {
  const response = await fetch(`http://127.0.0.1:${port}/?${query(claim)}`, {
    headers: { origin, 'cf-connecting-ip': visitor },
  })
  await response.text()
  return response.status
}
const close_all = async (clients: readonly Client[]) => {
  clients.forEach(({ ws }) => ws.close())
  await Promise.all(clients.map(({ closed }) => closed))
}
const accepted = (client: Client) => client.packets.find(({ type }) => type === 'packet/connection_accepted')
const inert = () => ({
  online_characters: () => [],
  is_agent: () => false,
  dispatch: () => {},
  on_message: () => {},
  on_close: () => {},
})

test('only a valid signature over the exact challenge admits its own address; refusals create no player', async () => {
  const keypair = new Ed25519Keypair()
  const bytes = toBase64(new TextEncoder().encode('aresrpg::f00d-1234'))
  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode('aresrpg::f00d-1234'))
  const login = { bytes, signature, address: keypair.toSuiAddress(), uuid: 'f00d-1234' }
  expect(await verify_login(login)).toBe(true)
  expect(await verify_login({ ...login, uuid: 'other' })).toBe(false)
  expect(await verify_login({ ...login, address: new Ed25519Keypair().toSuiAddress() })).toBe(false)
  expect(await verify_login({ ...login, bytes: 'AAAA', signature: 'trash' })).toBe(false)
  // zkLogin: both supported address derivations of one verified identity, never a foreign address.
  const identity = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const legacy = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: true })
  const spy = spyOn(signature_verification, 'verifyPersonalMessageSignature').mockResolvedValue(identity)
  try {
    expect(await verify_login({ ...login, address: identity.toSuiAddress() })).toBe(true)
    expect(await verify_login({ ...login, address: legacy.toSuiAddress() })).toBe(true)
    expect(await verify_login(login)).toBe(false)
  } finally {
    spy.mockRestore()
  }
  // The socket door: a fresh challenge, promotion only on a verified proof, nothing before it.
  for (const [verified, packet, reason, promoted] of [
    [true, proof, null, 1],
    [false, proof, 'INVALID_SIGNATURE', 0],
    [true, JSON.stringify({ type: 'packet/ping', id: 1 }), 'INVALID_PACKET', 0],
    [true, 'garbage', 'INVALID_PACKET', 0],
  ] as const) {
    const sent: unknown[] = []
    const closed: string[] = []
    let promotions = 0
    const connection = create_connection({
      claim: { stage: 'seated', address: '0xowner' },
      challenge: 'fresh',
      send: (packet) => void sent.push(packet),
      close: (_code, why) => void closed.push(why),
      verify: async ({ uuid }) => verified && uuid === 'fresh',
      promote: () => {
        promotions++
        return inert()
      },
    })
    expect(sent[0]).toEqual({ type: 'packet/signature_request', payload: 'fresh' })
    await connection.on_message(packet)
    expect([promotions, closed]).toEqual([promoted, reason ? [reason] : []])
    if (promoted)
      expect(sent.at(-1)).toEqual({ type: 'packet/connection_accepted', stage: 'seated', address: '0xowner' })
    connection.on_close()
  }
})

test('the upgrade URL fixes the claim; a malformed address, flag or origin is refused', async () => {
  const owner = `0x${'ab'.repeat(32)}`
  expect(read_claim(new URLSearchParams(''))).toEqual({ stage: 'open' })
  expect(read_claim(new URLSearchParams(`address=${owner}`))).toEqual({ stage: 'signed', address: owner })
  expect(read_claim(new URLSearchParams(`address=${owner.toUpperCase().replace('0X', '0x')}&seat=1`))).toEqual({
    stage: 'seated',
    address: owner,
  })
  for (const bad of [`address=${owner}&seat=true`, 'seat=1', 'address=', 'address=0xnope'])
    expect(read_claim(new URLSearchParams(bad))).toBeNull()
  expect(await knock({ address: owner, seat: true }, '192.0.2.9', 'https://evil.example')).toBe(403)
  const response = await fetch(`http://127.0.0.1:${port}/?seat=true`, { headers: { origin: ORIGIN } })
  expect([response.status, await response.text()]).toEqual([400, 'invalid claim'])
  const open = await admit({}, '192.0.2.1')
  expect([accepted(open), open.packets.some(({ type }) => type === 'packet/signature_request')]).toEqual([
    { type: 'packet/connection_accepted', stage: 'open' },
    false,
  ])
  await close_all([open])
})

test('a close during verification keeps its pending slot until verification settles', async () => {
  const admission = create_admission_slots(1)
  const verification = Promise.withResolvers<boolean>()
  let promotions = 0
  const connection = create_connection({
    claim: { stage: 'seated', address: '0xowner' },
    send: () => {},
    close: () => {},
    verify: () => verification.promise,
    release_pending: admission.reserve()!,
    promote: () => {
      promotions++
      return inert()
    },
  })
  const pending = connection.on_message(proof)
  connection.on_close()
  expect(admission.reserve()).toBeNull()
  verification.resolve(true)
  await pending
  expect([promotions, admission.size()]).toEqual([0, 0])
})

test('one visitor holds at most four unproven logins while others still enter; closing one frees it', async () => {
  const visitor = '203.0.113.7'
  const unproven = await Promise.all([1, 2, 3, 4].map((digit) => connect({ address: address(String(digit)) }, visitor)))
  try {
    await Promise.all(unproven.map(({ next }) => next('packet/signature_request')))
    expect(await knock({ address: address('5') }, visitor)).toBe(503)
    expect(await knock({ address: address('5') }, '198.51.100.20')).toBe(500)
    expect(await knock({}, visitor)).toBe(500)
    unproven[0]!.ws.close()
    await unproven[0]!.closed
    await Bun.sleep(20)
    expect(await knock({ address: address('5') }, visitor)).toBe(500)
  } finally {
    await close_all(unproven.slice(1))
  }
})

test('every non-seat socket meets one cap: 64 per visitor and MAX_VIEWERS per pod; seats are not counted', async () => {
  const crowd = await Promise.all(Array.from({ length: 64 }, () => admit({}, '198.51.100.1')))
  const others: Client[] = []
  try {
    expect(await knock({}, '198.51.100.1')).toBe(503)
    expect(await knock({ address: address('1') }, '198.51.100.1')).toBe(503)
    expect(await knock({}, '198.51.100.2')).toBe(500)
    crowd[0]!.ws.close()
    await crowd[0]!.closed
    await Bun.sleep(20)
    expect(await knock({}, '198.51.100.1')).toBe(500)
    others.push(...(await Promise.all(Array.from({ length: 4 }, () => admit({}, '198.51.100.2')))))
    others.push(await admit({ address: address('2') }, '198.51.100.3'))
    expect(await knock({}, '198.51.100.4')).toBe(503)
    expect(await knock({ address: address('3') }, '198.51.100.4')).toBe(503)
    expect(await knock({ address: address('4'), seat: true }, '198.51.100.4')).toBe(500)
  } finally {
    await close_all([...crowd.slice(1), ...others])
  }
})

test('views of one address coexist with its seat; a newer seat replaces it; MAX_PLAYERS refuses a new seat', async () => {
  const owner = address('e')
  const seat = await admit({ address: owner, seat: true }, '192.0.2.2')
  const views = [await admit({ address: owner }, '192.0.2.2'), await admit({ address: owner }, '192.0.2.3')]
  const fillers = [
    await admit({ address: address('6'), seat: true }, '192.0.2.5'),
    await admit({ address: address('7'), seat: true }, '192.0.2.6'),
  ]
  try {
    expect(accepted(seat)).toEqual({ type: 'packet/connection_accepted', stage: 'seated', address: owner })
    for (const view of views)
      expect(accepted(view)).toEqual({ type: 'packet/connection_accepted', stage: 'signed', address: owner })
    const replacement = await admit({ address: owner, seat: true }, '192.0.2.4')
    expect(await seat.closed).toEqual({ code: 1000, reason: 'REPLACED' })
    expect(views.map(({ ws }) => ws.readyState)).toEqual([WebSocket.OPEN, WebSocket.OPEN])
    const refused = await connect({ address: address('8'), seat: true }, '192.0.2.7')
    await refused.next('packet/signature_request')
    refused.ws.send(proof)
    expect(await refused.closed).toEqual({ code: 1008, reason: 'SERVER_FULL' })
    await close_all([replacement])
  } finally {
    await close_all([...views, ...fillers])
  }
})

test('a server drop for a flood bans that address for the TTL; a lifecycle close never bans', async () => {
  const flooder = address('f')
  const seat = await admit({ address: flooder, seat: true }, '192.0.2.8')
  for (let id = 0; id < 200; id++) seat.ws.send(JSON.stringify({ type: 'packet/ping', id }))
  expect(await seat.closed).toEqual({ code: 1008, reason: 'RATE_LIMIT' })
  expect(await knock({ address: flooder, seat: true }, '192.0.2.8')).toBe(403)
  expect(await knock({ address: flooder }, '192.0.2.8')).toBe(403)
  const quitter = await admit({ address: address('9'), seat: true }, '192.0.2.10')
  await close_all([quitter])
  expect(await knock({ address: address('9'), seat: true }, '192.0.2.10')).toBe(500)
  // The cool-off is memory with a TTL and a size cap; a repeat offense refreshes its recency.
  let clock = 0
  const bans = create_ban_list({ ttl_ms: 600_000, capacity: 2, now: () => clock })
  bans.ban('0xa')
  bans.ban('0xb')
  clock = 1
  bans.ban('0xa')
  bans.ban('0xc')
  expect(['0xa', '0xb', '0xc'].map(bans.is_banned)).toEqual([true, false, true])
  clock = 600_001
  expect(bans.is_banned('0xa')).toBe(false)
})
