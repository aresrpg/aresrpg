// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { hosted_challenge_message, type HostedChallengeInput } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { join_telegram_waitlist } from '../../src/landing/telegram_waitlist.ts'

const OWNER = `0x${'1'.repeat(64)}`
const ISSUER = 'https://bot.test'
const WEB = 'https://app.test'
const identity = { owner: OWNER, zklogin_public_identifier: 'identifier' }
const wallet = (signed: string[]) =>
  ({
    identity: 'zklogin',
    read_agent_pairing_request: (nonce: string) => ({ version: 1, nonce, network: 'mainnet', ...identity }),
    sign_personal_message: async (message: Uint8Array) => {
      signed.push(new TextDecoder().decode(message))
      return { bytes: '', signature: 'signature' }
    },
  }) as unknown as AuthSession

/** The hosted bot's three answers. `tamper` rewrites the challenge the way a hostile endpoint would. */
const service = (tamper: (input: HostedChallengeInput) => Partial<HostedChallengeInput> = () => ({})) => {
  const requests: { path: string; body: Record<string, unknown>; credentials?: RequestCredentials }[] = []
  const fetcher = (async (url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push({ path: url.pathname, body, credentials: init.credentials })
    if (url.pathname !== '/connect/challenge') return Response.json({ joined: true })
    const input = { ...(body as HostedChallengeInput), ...tamper(body as HostedChallengeInput) }
    const expires_at = Date.now() + 60_000
    return Response.json({
      authorization_id: 'authorization',
      challenge_id: 'challenge',
      expires_at,
      message: hosted_challenge_message({
        purpose: 'session',
        issuer: ISSUER,
        network: 'mainnet',
        authority_generation: 'generation',
        authorization_id: 'authorization',
        session_hash: 'session',
        nonce: 'challenge',
        owner: input.owner,
        zklogin_public_identifier: input.zklogin_public_identifier,
        client_id: 'first-party',
        redirect_uri: WEB,
        resource: `${ISSUER}/mcp`,
        scopes: [],
        expires_at,
        consent: null,
      }),
    })
  }) as unknown as typeof fetch
  return { requests, options: { origin: ISSUER, web_origin: WEB, fetcher } }
}

test('joining proves the signed-in address with a signed session challenge before the bot stores it', async () => {
  const signed: string[] = []
  const bot = service()
  await join_telegram_waitlist(wallet(signed), bot.options)
  expect(bot.requests.map(({ path }) => path)).toEqual(['/connect/challenge', '/connect/verify', '/connect/waitlist'])
  expect(bot.requests.every(({ credentials }) => credentials === 'include')).toBe(true)
  expect(bot.requests[0]!.body).toEqual({ ...identity, purpose: 'session' })
  expect(signed).toHaveLength(1)
  expect(signed[0]).toContain(OWNER)
  expect(bot.requests[1]!.body).toEqual({ challenge_id: 'challenge', signature: 'signature' })
  // The request names only its session: the bot stores the owner that session proved, never a sent address.
  expect(bot.requests[2]!.body).toEqual({ authorization_id: 'authorization' })
})

test('a challenge for another address is never signed and nothing is stored', async () => {
  const signed: string[] = []
  const bot = service(() => ({ owner: `0x${'2'.repeat(64)}` }))
  await expect(join_telegram_waitlist(wallet(signed), bot.options)).rejects.toThrow()
  expect(signed).toEqual([])
  expect(bot.requests.map(({ path }) => path)).toEqual(['/connect/challenge'])
})

test('a refused step ends the join; only a Google account can ask', async () => {
  const signed: string[] = []
  const refusing = service()
  const fetcher = (async (url: URL, init: RequestInit) =>
    url.pathname === '/connect/verify'
      ? Response.json({ error: 'rate_limited' }, { status: 429 })
      : refusing.options.fetcher(url, init)) as unknown as typeof fetch
  await expect(join_telegram_waitlist(wallet(signed), { ...refusing.options, fetcher })).rejects.toThrow(
    'waitlist_request_refused_429'
  )
  expect(refusing.requests.map(({ path }) => path)).toEqual(['/connect/challenge'])
  const other = { ...wallet(signed), identity: 'wallet' } as unknown as AuthSession
  await expect(join_telegram_waitlist(other, refusing.options)).rejects.toThrow('Google wallet required')
  await expect(join_telegram_waitlist(wallet(signed), { ...refusing.options, origin: '' })).rejects.toThrow(
    'bot_service_unconfigured'
  )
})
