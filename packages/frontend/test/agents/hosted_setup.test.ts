// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { HostedOwnerStatus } from '@aresrpg/protocol'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { prepare_agent_pairing } from '@aresrpg/sdk/agent-signer'

import {
  prepare_hosted,
  prepare_standalone_hosted,
  setup_hosted,
  refresh_hosted_owner,
  create_hosted_client,
} from '../../src/agents/hosted_client.ts'
import { initial_owner_connection } from '../../src/agents/owner_state.ts'
import type { AuthSession } from '../../src/auth.ts'
import * as app from '../../src/store.ts'

const fixture = async (existing: boolean, standalone = false) => {
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const member = {
    public_key: key.getPublicKey(),
    storage: 'persistent' as const,
    sign_personal_message: (bytes: Uint8Array) => key.signPersonalMessage(bytes),
    sign_transaction: async () => {
      throw new Error('No transactions')
    },
  }
  const request = (nonce: string) => ({
    version: 1 as const,
    network: 'mainnet' as const,
    nonce,
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  })
  const pairing = await prepare_agent_pairing(request(crypto.randomUUID()), member)
  const bot = {
    id: 'bot',
    address: pairing.signer.address,
    multisig_public_key: pairing.signer.public_key.toBase64(),
    generation: 1,
    policy_revision: 1,
    status: 'ready' as const,
  }
  const wallet = {
    identity: 'zklogin',
    address: google.toSuiAddress(),
    read_agent_pairing_request: request,
    sign_personal_message: async () => {
      if (!standalone) throw new Error('Verified session must not sign again')
      return { signature: 'fixture-owner-proof' }
    },
  } as unknown as AuthSession
  const read = spyOn(app, 'read_app_state').mockReturnValue({
    session: { wallet, agent_connection: initial_owner_connection() },
  } as ReturnType<typeof app.read_app_state>)
  const published: unknown[] = []
  const dispatch = spyOn(app, 'dispatch_app').mockImplementation((input) => {
    published.push(input)
  })
  const previous_window = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://game.example' } },
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
    },
  })
  const controller = new AbortController()
  const calls: string[] = []
  const state = {
    existing,
    fail_create: false,
    retire: '',
    multiple: false,
    paused: false,
    oauth: false,
    invalid_proof: false,
  }
  const routes: Record<string, (init: RequestInit) => Response | Promise<Response>> = {
    'POST /connect/challenge': (init) => {
      const body = JSON.parse(String(init.body))
      const expires_at = Date.now() + 60_000
      return Response.json({
        authorization_id: 'temporary',
        challenge_id: 'nonce',
        expires_at,
        message:
          'AresRPG hosted bot session v1\n' +
          JSON.stringify({
            purpose: 'session',
            issuer: 'https://bot.example.test',
            network: 'mainnet',
            authority_generation: 'generation',
            authorization_id: 'temporary',
            session_hash: 'session',
            nonce: 'nonce',
            owner: body.owner,
            zklogin_public_identifier: body.zklogin_public_identifier,
            client_id: 'first-party',
            redirect_uri: 'https://game.example',
            resource: 'https://bot.example.test/mcp',
            scopes: [],
            expires_at,
            consent: null,
          }),
      })
    },
    'POST /connect/verify': () => {
      if (state.retire === 'verify') controller.abort(new Error('Cancelled after verification'))
      return Response.json({ owner: wallet.address, bots: state.existing ? [bot] : [] })
    },
    'POST /connect/cancel': (init) => {
      expect(JSON.parse(String(init.body))).toEqual({ authorization_id: 'temporary' })
      return Response.json({ ok: true })
    },
    'GET /connect/request': () =>
      Response.json({
        authorization_id: 'authorization',
        client_id: 'client',
        client_name: 'Fixture assistant',
        redirect_uri: 'https://assistant.example/callback',
        resource: 'https://bot.example.test/mcp',
        network: 'mainnet',
        scopes: ['bot:play'],
      }),
    'GET /connect/status': () =>
      Response.json({
        owner: wallet.address,
        status: state.existing ? 'connected' : 'disconnected',
        bot: state.existing ? bot : null,
        recovery_bots: [],
        expires_at: state.existing ? Date.now() + 60_000 : null,
      }),
    'GET /connect/bots': () =>
      Response.json({
        owner: wallet.address,
        bots: state.multiple
          ? [{ ...bot, id: 'second', address: '0x' + '2'.repeat(64) }, bot]
          : state.existing
            ? [{ ...bot, status: state.paused ? 'paused' : 'ready' }]
            : [],
      }),
    'POST /connect/bots': () => {
      if (state.fail_create) return Response.json({ error: 'unavailable' }, { status: 503 })
      state.existing = true
      if (state.retire === 'provision') controller.abort(new Error('Cancelled after provisioning'))
      return Response.json({ status: 'ready', bot })
    },
    'POST /connect/proof': async (init) => {
      const body = JSON.parse(String(init.body))
      const proof = await prepare_agent_pairing(body.request, member)
      if (state.retire === 'abort') controller.abort(new Error('Cancelled'))
      if (state.retire === 'wallet')
        read.mockReturnValue({ session: { wallet: null } } as ReturnType<typeof app.read_app_state>)
      return Response.json({
        status: 'ready',
        proof: state.invalid_proof ? { ...proof.response, signature: 'invalid' } : proof.response,
      })
    },
  }
  const fetcher = (async (url: URL, init: RequestInit) => {
    const route = `${init.method ?? 'GET'} ${url.pathname}`
    calls.push(route)
    if (!routes[route]) throw new Error('Unexpected fixture request')
    return routes[route](init)
  }) as unknown as typeof fetch
  const run = (naming = false) =>
    (naming ? prepare_hosted : setup_hosted)(
      create_hosted_client(
        'https://bot.example.test',
        controller.signal,
        { get_state: app.read_app_state, dispatch: app.dispatch_app },
        fetcher
      ),
      wallet,
      state.oauth ? 'authorization' : null,
      () => {},
      'verified-session'
    )
  return {
    run,
    run_standalone: () =>
      prepare_standalone_hosted(
        create_hosted_client(
          'https://bot.example.test',
          controller.signal,
          { get_state: app.read_app_state, dispatch: app.dispatch_app },
          fetcher
        ),
        wallet
      ),
    fetcher,
    refresh: (previous_status: HostedOwnerStatus | null = null) =>
      refresh_hosted_owner(
        create_hosted_client(
          'https://bot.example.test',
          controller.signal,
          { get_state: app.read_app_state, dispatch: app.dispatch_app },
          fetcher
        ),
        wallet,
        'verified-session',
        () => {},
        previous_status
      ),
    bind_connection: (result: Awaited<ReturnType<typeof refresh_hosted_owner>>) =>
      read.mockReturnValue({
        session: {
          wallet,
          inventory_pairing: { ...result.pairing, address: 'recovery', signer_mode: 'disposable' },
          agent_connection: { ...initial_owner_connection(), ...result, phase: 'ready' },
        },
      } as ReturnType<typeof app.read_app_state>),
    calls,
    published,
    state,
    bot,
    bind: (descriptor = bot.multisig_public_key) =>
      read.mockReturnValue({
        session: {
          wallet,
          inventory_pairing: { address: bot.address, multisig_public_key: descriptor, signer_mode: 'host-persistent' },
        },
      } as ReturnType<typeof app.read_app_state>),
    cleanup: () => {
      if (previous_window) Object.defineProperty(globalThis, 'window', previous_window)
      else Reflect.deleteProperty(globalThis, 'window')
      read.mockRestore()
      dispatch.mockRestore()
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    },
  }
}

test.each([false, true])(
  'Connect automatically provisions when needed and verifies a real fixture pairing: existing=%s',
  async (existing) => {
    const f = await fixture(existing)
    try {
      const result = await f.run()
      expect(result).toMatchObject({ selected: f.bot.id, verified: f.bot.id, consent: null })
      expect(f.calls).toEqual([
        'GET /connect/bots',
        ...(!existing ? ['POST /connect/bots'] : []),
        'POST /connect/proof',
      ])
      expect(f.published).toHaveLength(1)
      await f.run()
      expect(f.calls.filter((call) => call === 'POST /connect/bots')).toHaveLength(existing ? 0 : 1)
    } finally {
      f.cleanup()
    }
  }
)

test('failed creation can retry without publishing unverified success', async () => {
  const f = await fixture(false)
  try {
    f.state.fail_create = true
    await expect(f.run()).rejects.toThrow('Hosted service request failed')
    expect(f.published).toEqual([])
    f.state.fail_create = false
    await expect(f.run()).resolves.toMatchObject({ verified: f.bot.id })
  } finally {
    f.cleanup()
  }
})

test.each(['abort', 'wallet'])('automatic setup cannot publish after %s retirement', async (reason) => {
  const f = await fixture(false)
  try {
    f.state.retire = reason
    await expect(f.run()).rejects.toThrow()
    expect(f.published).toEqual([])
  } finally {
    f.cleanup()
  }
})

test.each(['multiple', 'paused', 'invalid_proof'] as const)(
  'setup fails closed for %s without publishing success',
  async (reason) => {
    const f = await fixture(true)
    try {
      f.state[reason] = true
      await expect(f.run()).rejects.toThrow()
      expect(f.published).toEqual([])
      expect(f.calls).not.toContain('POST /connect/bots')
    } finally {
      f.cleanup()
    }
  }
)

test('automatic setup retains OAuth scopes and callback without granting access', async () => {
  const f = await fixture(true)
  try {
    f.state.oauth = true
    await expect(f.run()).resolves.toMatchObject({
      verified: f.bot.id,
      consent: {
        scopes: ['bot:play'],
        redirect_uri: 'https://assistant.example/callback',
        client_id: 'client',
      },
    })
    expect(f.calls).not.toContain('POST /connect/authorize')
  } finally {
    f.cleanup()
  }
})

test('multiple bots cannot be selected through a local inventory preference', async () => {
  const f = await fixture(true)
  try {
    f.state.multiple = true
    f.bind()
    await expect(f.run()).rejects.toThrow('Multiple hosted bots require review')
    expect(f.calls).not.toContain('POST /connect/bots')
  } finally {
    f.cleanup()
  }
})

test('an address match with another descriptor cannot select among multiple bots', async () => {
  const f = await fixture(true)
  try {
    f.state.multiple = true
    f.bind('different-descriptor')
    await expect(f.run()).rejects.toThrow('Multiple hosted bots require review')
    expect(f.published).toEqual([])
  } finally {
    f.cleanup()
  }
})

test('owner refresh verifies the server-resolved wallet without provisioning or consent', async () => {
  const f = await fixture(true)
  try {
    const result = await f.refresh()
    expect(result).toMatchObject({
      response: { status: 'connected', bot: { id: f.bot.id } },
      pairing: {
        address: f.bot.address,
        multisig_public_key: f.bot.multisig_public_key,
        signer_mode: 'host-persistent',
      },
    })
    expect(f.published).toEqual([])
    expect(f.calls).toEqual(['GET /connect/bots', 'GET /connect/status', 'POST /connect/proof', 'GET /connect/status'])
  } finally {
    f.cleanup()
  }
})

test('an owner without a hosted wallet receives no automatic provisioning or consent', async () => {
  const f = await fixture(false)
  try {
    expect(await f.refresh()).toMatchObject({ response: { status: 'disconnected' }, pairing: null })
    expect(f.calls).toEqual(['GET /connect/bots', 'GET /connect/status'])
    expect(f.published).toEqual([])
  } finally {
    f.cleanup()
  }
})

test('connection proof reuse ignores the recovery inventory selection and still observes grant revocation', async () => {
  const f = await fixture(true)
  try {
    const verified = await f.refresh()
    f.bind_connection(verified)
    const before = f.calls.filter((call) => call === 'POST /connect/proof').length
    const refreshed = await f.refresh(verified.response)
    expect(refreshed.pairing).toEqual(verified.pairing)
    expect(f.calls.filter((call) => call === 'POST /connect/proof')).toHaveLength(before)
    f.state.existing = false
    expect(await f.refresh(refreshed.response)).toMatchObject({ response: { status: 'disconnected' }, pairing: null })
  } finally {
    f.cleanup()
  }
})

test('naming reuses hosted setup and recovery without inventory or authorization dispatch', async () => {
  const f = await fixture(false)
  try {
    f.bind()
    const result = await f.run(true)
    expect(result.pairing.address).toBe(f.bot.address)
    expect(f.published).toEqual([])
    expect(f.calls).toEqual(['GET /connect/bots', 'POST /connect/bots', 'POST /connect/proof'])
    await f.run(true)
    expect(f.calls.filter((call) => call === 'POST /connect/bots')).toHaveLength(1)
    expect(f.published).toEqual([])
  } finally {
    f.cleanup()
  }
})

test.each(['verify', 'provision', 'complete'])(
  'standalone naming cancels its temporary session after %s without deleting committed custody',
  async (stage) => {
    const f = await fixture(false, true)
    const fetcher = spyOn(globalThis, 'fetch').mockImplementation(f.fetcher)
    try {
      f.state.retire = stage
      if (stage === 'complete') await f.run_standalone()
      else await expect(f.run_standalone()).rejects.toThrow('Cancelled')
      expect(f.calls.at(-1)).toBe('POST /connect/cancel')
      expect(f.calls.filter((call) => call === 'POST /connect/cancel')).toHaveLength(1)
      expect(f.state.existing).toBe(stage !== 'verify')
      expect(f.published).toEqual([])
    } finally {
      fetcher.mockRestore()
      f.cleanup()
    }
  }
)
