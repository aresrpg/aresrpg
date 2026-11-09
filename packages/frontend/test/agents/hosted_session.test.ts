// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'

import { authenticate_hosted, create_hosted_client } from '../../src/agents/hosted_client.ts'
import type { AuthSession } from '../../src/auth.ts'
import * as app from '../../src/store.ts'

const consent = {
  authorization_id: 'request',
  client_id: 'client',
  client_name: 'Assistant',
  redirect_uri: 'https://assistant.example/callback',
  scopes: ['bot:observe'],
  resource: 'https://bot.example/mcp',
  network: 'mainnet',
}

test.each(['owner', 'foreign'])('existing hosted session is bound to the current wallet: %s', async (owner) => {
  let signatures = 0
  const wallet = {
    identity: 'zklogin',
    address: 'owner',
    read_agent_pairing_request: () => ({ owner: 'owner', zklogin_public_identifier: 'google' }),
    sign_personal_message: async () => {
      signatures++
      throw new Error('Unexpected signature')
    },
  } as unknown as AuthSession
  const read = spyOn(app, 'read_app_state').mockReturnValue({ session: { wallet } } as ReturnType<
    typeof app.read_app_state
  >)
  const requests: string[] = []
  const fetcher = (async (url: URL) => {
    requests.push(url.pathname)
    if (url.pathname === '/connect/request') return Response.json(consent)
    if (url.pathname === '/connect/bots') return Response.json({ owner, bots: [] })
    throw new Error('Unexpected authentication request')
  }) as unknown as typeof fetch
  try {
    const client = create_hosted_client('https://bot.example', new AbortController().signal, fetcher)
    const result = authenticate_hosted(client, wallet, 'request', () => {})
    if (owner === 'owner')
      await expect(result).resolves.toMatchObject({ authorization_id: 'request', bots: [], consent })
    else await expect(result).rejects.toThrow('Owner mismatch')
    expect(signatures).toBe(0)
    expect(requests).toEqual(['/connect/request', '/connect/bots'])
  } finally {
    read.mockRestore()
  }
})

test.each(['owner_authentication_required', 'storage_unavailable'])(
  'only an unverified session requests owner proof: %s',
  async (error) => {
    const wallet = {
      identity: 'zklogin',
      address: 'owner',
      read_agent_pairing_request: () => ({ owner: 'owner', zklogin_public_identifier: 'google' }),
    } as unknown as AuthSession
    const read = spyOn(app, 'read_app_state').mockReturnValue({ session: { wallet } } as ReturnType<
      typeof app.read_app_state
    >)
    const requests: string[] = []
    const fetcher = (async (url: URL) => {
      requests.push(url.pathname)
      if (url.pathname === '/connect/request') return Response.json(consent)
      if (url.pathname === '/connect/bots') return Response.json({ error }, { status: 400 })
      throw new Error('Owner proof requested')
    }) as unknown as typeof fetch
    try {
      const client = create_hosted_client('https://bot.example', new AbortController().signal, fetcher)
      await expect(authenticate_hosted(client, wallet, 'request', () => {})).rejects.toThrow(
        error === 'owner_authentication_required' ? 'Owner proof requested' : 'Hosted service request failed'
      )
      expect(requests).toEqual([
        '/connect/request',
        '/connect/bots',
        ...(error === 'owner_authentication_required' ? ['/connect/challenge'] : []),
      ])
    } finally {
      read.mockRestore()
    }
  }
)

test('expired standalone session requests and verifies a new wallet-bound challenge', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://game.example' } },
  })
  let signatures = 0
  const wallet = {
    identity: 'zklogin',
    address: 'owner',
    read_agent_pairing_request: () => ({ owner: 'owner', zklogin_public_identifier: 'google' }),
    sign_personal_message: async () => {
      signatures++
      return { signature: 'signed' }
    },
  } as unknown as AuthSession
  const read = spyOn(app, 'read_app_state').mockReturnValue({ session: { wallet } } as ReturnType<
    typeof app.read_app_state
  >)
  const calls: string[] = []
  const retained: string[] = []
  const fetcher = (async (url: URL, init: RequestInit) => {
    calls.push(url.pathname)
    if (url.pathname === '/connect/bots') return Response.json({ error: 'invalid_session' }, { status: 400 })
    if (url.pathname === '/connect/challenge') {
      const body = JSON.parse(String(init.body))
      expect(body).not.toHaveProperty('authorization_id')
      const expires_at = Date.now() + 60000
      return Response.json({
        authorization_id: 'fresh',
        challenge_id: 'nonce',
        expires_at,
        message:
          'AresRPG hosted bot session v1\n' +
          JSON.stringify({
            purpose: 'session',
            issuer: 'https://bot.example',
            network: 'mainnet',
            authority_generation: 'generation',
            authorization_id: 'fresh',
            session_hash: 'session',
            nonce: 'nonce',
            owner: body.owner,
            zklogin_public_identifier: body.zklogin_public_identifier,
            client_id: 'first-party',
            redirect_uri: 'https://game.example',
            resource: 'https://bot.example/mcp',
            scopes: [],
            expires_at,
            consent: null,
          }),
      })
    }
    if (url.pathname === '/connect/verify') return Response.json({ owner: 'owner', bots: [] })
    throw new Error('Unexpected request')
  }) as unknown as typeof fetch
  try {
    const client = create_hosted_client('https://bot.example', new AbortController().signal, fetcher)
    await expect(
      authenticate_hosted(
        client,
        wallet,
        null,
        (id) => {
          retained.push(id)
        },
        'expired'
      )
    ).resolves.toMatchObject({
      authorization_id: 'fresh',
      bots: [],
      consent: null,
    })
    expect(calls).toEqual(['/connect/bots', '/connect/challenge', '/connect/verify'])
    expect(retained).toEqual(['fresh'])
    expect(signatures).toBe(1)
  } finally {
    read.mockRestore()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test.each(['/connect/request', '/connect/bots'])(
  'expired OAuth request at %s cannot become standalone',
  async (failed_path) => {
    const wallet = {
      identity: 'zklogin',
      address: 'owner',
      read_agent_pairing_request: () => ({ owner: 'owner', zklogin_public_identifier: 'google' }),
    } as unknown as AuthSession
    const read = spyOn(app, 'read_app_state').mockReturnValue({ session: { wallet } } as ReturnType<
      typeof app.read_app_state
    >)
    const calls: string[] = []
    const fetcher = (async (url: URL) => {
      calls.push(url.pathname)
      if (url.pathname === failed_path) return Response.json({ error: 'invalid_session' }, { status: 400 })
      if (url.pathname === '/connect/request') return Response.json(consent)
      throw new Error('Unexpected request')
    }) as unknown as typeof fetch
    try {
      const client = create_hosted_client('https://bot.example', new AbortController().signal, fetcher)
      await expect(authenticate_hosted(client, wallet, 'request', () => {})).rejects.toThrow(
        'Hosted service request failed'
      )
      expect(calls).not.toContain('/connect/challenge')
    } finally {
      read.mockRestore()
    }
  }
)

test.each(['wallet', 'abort'])(
  'expired-session recovery rejects late responses after %s retirement',
  async (reason) => {
    const controller = new AbortController()
    const wallet = {
      identity: 'zklogin',
      address: 'owner',
      read_agent_pairing_request: () => ({ owner: 'owner', zklogin_public_identifier: 'google' }),
    } as unknown as AuthSession
    let current: AuthSession | null = wallet
    const read = spyOn(app, 'read_app_state').mockImplementation(
      () => ({ session: { wallet: current } }) as ReturnType<typeof app.read_app_state>
    )
    const calls: string[] = []
    const fetcher = (async (url: URL) => {
      calls.push(url.pathname)
      if (reason === 'wallet') current = null
      else controller.abort(new Error('Retired'))
      return Response.json({ error: 'invalid_session' }, { status: 400 })
    }) as unknown as typeof fetch
    try {
      const client = create_hosted_client('https://bot.example', controller.signal, fetcher)
      await expect(authenticate_hosted(client, wallet, null, () => {}, 'expired')).rejects.toThrow(
        reason === 'wallet' ? 'Wallet changed' : 'Retired'
      )
      expect(calls).toEqual(['/connect/bots'])
    } finally {
      read.mockRestore()
    }
  }
)
