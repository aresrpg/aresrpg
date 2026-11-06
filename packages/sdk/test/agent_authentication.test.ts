// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn as spy_on, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import type { ServerPacket } from '@aresrpg/protocol'

import { create_agent_connection } from '../src/agent_connection.ts'
import { create_bun_agent_transport } from '../examples/agent_transport.ts'
import { create_agent_multisig } from '../src/agent_multisig.ts'
import { bootstrap_disposable_agent } from '../examples/agent_bootstrap.ts'
import { verify_agent_pairing } from '../src/agent_pairing.ts'
import { create_agent_run } from '../examples/agent_kit.ts'

type LoginProof = Readonly<{ bytes: string; signature: string; address: string; uuid: string }>
type FixtureConnection = Readonly<{ on_message: (raw: string | Buffer) => Promise<void>; on_close: () => void }>

// Disposable in-memory keys and synthetic Google metadata. This proves authentication only:
// the empty roster/player below is a fixture, never evidence of indexed ownership or gameplay.
const identity = () => {
  const keypair = new Ed25519Keypair()
  return create_agent_multisig({
    agent_public_key: keypair.getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
    sign_personal_message: (message) => keypair.signPersonalMessage(message),
  })
}

const wait_for = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (!predicate() && Date.now() < deadline) await Bun.sleep(5)
  expect(predicate()).toBe(true)
}

const fixture_server = async () => {
  // Runtime imports exercise the actual server without adding its tooling to the SDK type graph.
  const [{ verify_login }, { create_pending_admission }, { create_authenticated_connection }] = await Promise.all([
    import(new URL('../../server/src/auth.ts', import.meta.url).href),
    import(new URL('../../server/src/admission.ts', import.meta.url).href),
    import(new URL('../../server/src/connection.ts', import.meta.url).href),
  ])
  const pending = create_pending_admission()
  const handlers = new Map<unknown, FixtureConnection>()
  const proofs: LoginProof[] = []
  const promotions: string[] = []
  const origins: (string | null)[] = []
  const server = Bun.serve<{ address: string; release: () => void }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      origins.push(request.headers.get('origin'))
      const release = pending.reserve()
      if (!release) return new Response('full', { status: 503 })
      const address = new URL(request.url).searchParams.get('address') ?? ''
      if (listener.upgrade(request, { data: { address, release } })) return
      release()
      return new Response('upgrade required', { status: 400 })
    },
    websocket: {
      open(ws) {
        handlers.set(
          ws,
          create_authenticated_connection({
            address: ws.data.address,
            release_pending: ws.data.release,
            send: (packet: ServerPacket) => {
              ws.send(JSON.stringify(packet))
              // Fixture projection follows real admission, as the production asynchronous roster does.
              if (packet.type === 'packet/connection_accepted')
                ws.send(JSON.stringify({ type: 'packet/characters', characters: [] }))
            },
            close: (code: number, reason: string) => ws.close(code, reason),
            verify: async (proof: LoginProof) => {
              proofs.push(proof)
              return verify_login(proof)
            },
            promote: () => {
              promotions.push(ws.data.address)
              return { online_characters: () => [], dispatch: () => {}, on_message: () => {}, on_close: () => {} }
            },
          })
        )
      },
      message(ws, raw) {
        void handlers.get(ws)?.on_message(raw)
      },
      close(ws) {
        handlers.get(ws)?.on_close()
        handlers.delete(ws)
      },
    },
  })
  return {
    server,
    pending,
    proofs,
    promotions,
    origins,
    handlers,
    verify_login,
    endpoint: `ws://127.0.0.1:${server.port}`,
  }
}

test('real ordinary partial multisig authenticates over loopback; rejects wrong signer/challenge and reconnects', async () => {
  // Any accidental RPC through fetch fails closed; no cryptographic verifier is mocked.
  const fixture = await fixture_server()
  const { verify_login } = fixture
  const deny_fetch = Object.assign(
    () => {
      throw new Error('RPC forbidden in offline authentication fixture')
    },
    { preconnect: globalThis.fetch.preconnect }
  )
  const network = spy_on(globalThis, 'fetch').mockImplementation(deny_fetch)
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const request = {
    version: 1,
    nonce: crypto.randomUUID(),
    network: 'mainnet',
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }
  const bootstrap = await bootstrap_disposable_agent(request)
  const paired = await verify_agent_pairing(request, bootstrap.response)
  const agent = bootstrap.signer
  expect(agent.address).toBe(paired.address)
  const other = identity()
  const connections: ReturnType<typeof create_agent_connection>[] = []
  const connect = (signer: Parameters<typeof create_agent_connection>[0]['signer']) => {
    const connection = create_agent_connection({
      endpoint: fixture.endpoint,
      origin: 'http://localhost:5173',
      signer,
      transport: create_bun_agent_transport(),
    })
    connections.push(connection)
    connection.connect()
    return connection
  }
  try {
    const wrong_signer = connect({ address: agent.address, sign_personal_message: other.sign_personal_message })
    await wait_for(() => wrong_signer.state().status === 'stopped')
    expect(wrong_signer.state().error).toBe('INVALID_SIGNATURE')
    expect(fixture.promotions).toEqual([])

    const wrong_challenge = connect({
      address: agent.address,
      sign_personal_message: async (message) => {
        const stale = await agent.sign_personal_message(new TextEncoder().encode(`aresrpg::${crypto.randomUUID()}`))
        return { ...stale, bytes: Buffer.from(message).toString('base64') }
      },
    })
    await wait_for(() => wrong_challenge.state().status === 'stopped')
    expect(wrong_challenge.state().error).toBe('INVALID_SIGNATURE')
    expect(fixture.promotions).toEqual([])

    const valid = connect(agent)
    await wait_for(() => valid.state().status === 'ready')
    expect(valid.state().characters).toEqual([])
    expect(fixture.promotions).toEqual([agent.address])
    const first = fixture.proofs[2]!
    const parsed = parseSerializedSignature(first.signature)
    expect(parsed.signatureScheme).toBe('MultiSig')
    if (parsed.signatureScheme !== 'MultiSig') throw new Error('Expected multisig proof')
    expect(parsed.multisig.sigs).toHaveLength(1)
    expect(parsed.multisig.bitmap).toBe(1)
    expect(parsed.multisig.multisig_pk.threshold).toBe(1)
    expect(await verify_login(first)).toBe(true)
    expect(await verify_login({ ...first, uuid: crypto.randomUUID() })).toBe(false)
    expect(await verify_login({ ...first, address: other.address })).toBe(false)

    valid.disconnect()
    expect(valid.state().status).toBe('disconnected')
    expect(valid.state().characters).toEqual([])
    valid.reconnect()
    expect(valid.state().status).toBe('connecting')
    await wait_for(() => valid.state().status === 'ready')
    expect(fixture.promotions).toEqual([agent.address, agent.address])
    const second = fixture.proofs[3]!
    expect(second.uuid).not.toBe(first.uuid)
    expect(second.signature).not.toBe(first.signature)
    expect(await verify_login({ ...first, uuid: second.uuid })).toBe(false)
    expect(fixture.pending.size()).toBe(0)
    expect(fixture.origins).toEqual(Array(4).fill('http://localhost:5173'))
    expect(network).not.toHaveBeenCalled()
  } finally {
    connections.forEach((connection) => connection.stop())
    // Forced stop closes this fixture even when an assertion fails during the handshake.
    void fixture.server.stop(true)
    network.mockRestore()
  }
  await wait_for(() => fixture.handlers.size === 0)
  expect(fixture.pending.size()).toBe(0)
}, 5000)

test('mainnet pairing authenticates with an explicitly injected loopback transport before stop', async () => {
  const fixture = await fixture_server()
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const request = {
    version: 1,
    nonce: crypto.randomUUID(),
    network: 'mainnet',
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }
  const client = await bootstrap_disposable_agent(request)
  const verified = await verify_agent_pairing(request, client.response)
  const run = create_agent_run(
    {
      version: 1,
      strategy: 'observe',
      objective: 'Local pairing proof',
      endpoint: fixture.endpoint,
      origin: 'http://localhost:5173',
      character_ids: [],
      duration_ms: 2000,
      max_spend_mist: '0',
    },
    { signer: client.signer, transport: create_bun_agent_transport() }
  )
  try {
    await wait_for(() => run.status().status === 'ready')
    expect(fixture.promotions).toEqual([verified.address])
    run.stop()
    expect((await run.done).reason).toBe('requested')
  } finally {
    run.stop()
    fixture.server.stop(true)
  }
})
