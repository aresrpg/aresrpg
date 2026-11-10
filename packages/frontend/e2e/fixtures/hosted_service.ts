// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { hosted_challenge_message } from '@aresrpg/protocol'

import { create_agent_identity } from '../../../sdk/src/agent_multisig.ts'
import { prepare_agent_pairing } from '../../../sdk/src/agent_signer.ts'

export const service = 'https://bot.fixture.example'
export const owner = '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'
const fixture_challenge = (url: string, body: Record<string, unknown>, resource: string, expires_at: number) => {
  const page_url = new URL(url)
  const review = page_url.searchParams.has('authorization_id')
    ? {
        client_id: 'fixture-client',
        redirect_uri: 'https://assistant.fixture.example/callback',
        scopes: ['bot:observe'],
      }
    : { client_id: 'first-party', redirect_uri: page_url.origin, scopes: [] }
  return hosted_challenge_message({
    purpose: body.purpose as 'session' | 'consent',
    issuer: service,
    network: 'mainnet',
    authority_generation: 'generation',
    authorization_id: 'fixture-auth',
    session_hash: 'session',
    nonce: 'fixture-challenge',
    owner: body.owner as string,
    zklogin_public_identifier: body.zklogin_public_identifier as string,
    client_id: review.client_id,
    redirect_uri: review.redirect_uri,
    resource,
    scopes: review.scopes,
    expires_at,
    consent:
      body.purpose === 'consent'
        ? {
            bot_id: body.bot_id as string,
            generation: body.generation as number,
            policy_revision: body.policy_revision as number,
            address: body.address as string,
            multisig_public_key: body.multisig_public_key as string,
          }
        : null,
  })
}
export const connector_fixture = () => ({
  authorized: false,
  returning: false,
  drain_reads: 0,
  completed: 0,
  expired: false,
  ambiguous: false,
  stale_proof: false,
  revoke_during_proof: false,
})
export const mock_hosted = async (page: Page, resource = `${service}/mcp`, connection = connector_fixture()) => {
  // Public deterministic test fixture, never a real credential or network signer.
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const identity = create_agent_identity({
    agent_public_key: key.getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
  })
  const bot = {
    id: 'fixture-bot',
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    generation: 1,
    policy_revision: 1,
    status: 'ready',
  }
  let authenticated = false
  const requests: { path: string; body: Record<string, unknown> }[] = []
  const reply = (json: unknown, status = 200) => ({ json, status })
  const handlers: Record<
    string,
    (body: Record<string, unknown>, method: string) => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>
  > = {
    '/connect/disconnect': () => {
      connection.authorized = false
      if (!connection.returning) {
        connection.returning = true
        bot.status = 'returning'
        bot.generation += 1
      }
      const draining = connection.drain_reads > 0
      connection.drain_reads = Math.max(0, connection.drain_reads - 1)
      return reply({ bot, phase: draining ? 'draining' : 'stopped' })
    },
    '/connect/return-complete': () => {
      connection.returning = false
      connection.completed += 1
      bot.status = 'ready'
      return reply({ bot, phase: 'complete' })
    },
    '/connect/request': () =>
      reply({
        authorization_id: 'fixture-auth',
        client_name: 'Fixture assistant',
        client_id: 'fixture-client',
        redirect_uri: 'https://assistant.fixture.example/callback',
        scopes: ['bot:observe'],
        resource,
        network: 'mainnet',
      }),
    '/connect/challenge': (body) => {
      const expires_at = Date.now() + 60_000
      return reply({
        authorization_id: 'fixture-auth',
        challenge_id: 'fixture-challenge',
        message: fixture_challenge(page.url(), body, resource, expires_at),
        expires_at,
      })
    },
    '/connect/verify': () => {
      authenticated = true
      return reply({ owner, bots: [bot] })
    },
    '/connect/cancel': () => {
      authenticated = false
      return reply({ cancelled: true })
    },
    '/connect/bots': (_body, method) => {
      if (method === 'GET')
        return authenticated ? reply({ owner, bots: [bot] }) : reply({ error: 'owner_authentication_required' }, 400)
      return reply({ status: 'ready', bot })
    },
    '/connect/status': () =>
      reply({
        owner,
        status: connection.ambiguous ? 'ambiguous' : connection.authorized ? 'connected' : 'disconnected',
        bot: connection.ambiguous ? null : bot,
        recovery_bots: [],
        expires_at: connection.expired ? Date.now() - 1 : Date.now() + 60_000,
      }),
    '/connect/authorize': () => reply({ redirect_url: 'https://assistant.fixture.example/callback?code=fixture-code' }),
    '/connect/proof': async (body) => {
      const request = connection.stale_proof
        ? { ...(body.request as object), nonce: '22222222-2222-4222-8222-222222222222' }
        : body.request
      const proof = await prepare_agent_pairing(request, {
        storage: 'persistent',
        public_key: key.getPublicKey(),
        sign_personal_message: (bytes) => key.signPersonalMessage(bytes),
        sign_transaction: async () => {
          throw new Error('Transactions forbidden in fixture')
        },
      })
      if (connection.revoke_during_proof) connection.authorized = false
      return reply({ status: 'ready', proof: proof.response })
    },
  }
  await page.route(`${service}/connect/**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body = request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : {}
    requests.push({ path, body })
    await route.fulfill({
      ...(await handlers[path]!(body, request.method())),
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
    })
  })
  await page.route('https://assistant.fixture.example/**', (route) => {
    connection.authorized = true
    return route.fulfill({ body: 'Fixture authorization callback' })
  })
  return { requests, bot, connection }
}
