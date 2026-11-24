// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The hosted agent service, as the player's own account reaches it: a session is reused only for the wallet that
// owns it, nothing is asked of a service the deployment does not name, a changed wallet or a closed page stops the
// flow before any signature, and the window's state refuses every answer to an earlier attempt.
import { afterEach, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { prepare_agent_pairing } from '@aresrpg/sdk/agent-signer'

import { authenticate_hosted, create_hosted_client, verify_hosted_bot } from '../src/agents/hosted_client.ts'
import { empty_hosted, reduce_hosted } from '../src/agents/hosted_state.ts'
import { begin_setup_name } from '../src/agents/naming_barrier.ts'
import { resolve_bot_service_url } from '../src/env.ts'
import { SITE_MODULES } from '../src/site_modules.ts'
import { dispatch_app, read_app_state } from '../src/store.ts'

import { fake_wallet, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const consent = {
  authorization_id: 'request',
  client_id: 'client',
  client_name: 'Assistant',
  redirect_uri: 'https://assistant.example/callback',
  scopes: ['bot:observe'],
  resource: 'https://bot.example/mcp',
  network: 'mainnet',
}

test('a hosted session is reused only for its owner, and a changed wallet or a closed page signs nothing', async () => {
  const signatures: string[] = []
  const wallet = fake_wallet({
    read_agent_pairing_request: () => ({ owner: `0x${'a'.repeat(64)}`, zklogin_public_identifier: 'google' }),
    sign_personal_message: async () => {
      signatures.push('signed')
      throw new Error('Unexpected signature')
    },
  })
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  const app = { get_state: read_app_state, dispatch: dispatch_app }
  const asked: string[] = []
  const service = (owner: string) =>
    (async (url: URL) => {
      asked.push(url.pathname)
      if (url.pathname === '/connect/request') return Response.json(consent)
      if (url.pathname === '/connect/bots') return Response.json({ owner, bots: [] })
      throw new Error(`Unexpected request ${url.pathname}`)
    }) as unknown as typeof fetch
  const page = new AbortController()
  const own = create_hosted_client('https://bot.example', page.signal, app, service(wallet.address))
  await expect(authenticate_hosted(own, wallet, 'request', () => {})).resolves.toMatchObject({
    authorization_id: 'request',
    bots: [],
    consent,
  })
  // The service answers for another owner: the session is refused, not adopted.
  const foreign = create_hosted_client('https://bot.example', page.signal, app, service('0xsomeone'))
  await expect(authenticate_hosted(foreign, wallet, 'request', () => {})).rejects.toThrow('Owner mismatch')
  expect(asked).toEqual(['/connect/request', '/connect/bots', '/connect/request', '/connect/bots'])
  // A deployment that names no service asks nothing at all.
  const none = create_hosted_client('', page.signal, app, service(wallet.address))
  await expect(authenticate_hosted(none, wallet, 'request', () => {})).rejects.toThrow('Hosted service unavailable')
  expect(asked).toHaveLength(4)
  // The player signs out: the flow of the previous wallet stops; a closed page stops it too.
  site.dispatch({ type: 'auth/disconnected' })
  await settle()
  await expect(authenticate_hosted(own, wallet, 'request', () => {})).rejects.toThrow('Wallet changed')
  page.abort()
  await expect(authenticate_hosted(own, wallet, 'request', () => {})).rejects.toThrow()
  expect(signatures).toEqual([])
})

test('the hosted window refuses answers to an earlier attempt and only an explicit retry starts again', () => {
  const pending = reduce_hosted(empty_hosted<string>(), { type: 'start', phase: 'authenticating' })
  // A second activation cannot restart a pending step.
  expect(reduce_hosted(pending, { type: 'start', phase: 'authenticating' })).toBe(pending)
  // Close, back or another account retires every late completion.
  const retired = reduce_hosted(pending, { type: 'reset', session: null })
  const late = {
    type: 'result',
    generation: pending.generation,
    values: { phase: 'ready', authorization_id: 'old', bots: ['old'], consent: null },
  } as const
  expect(reduce_hosted(retired, late)).toBe(retired)
  expect(retired).toMatchObject({ authorization_id: null, bots: [] })
  // A failure permits an explicit retry, and the answer to the failed attempt is refused.
  const failed = reduce_hosted(pending, { type: 'result', generation: pending.generation, values: { phase: 'failed' } })
  const retry = reduce_hosted(failed, { type: 'start', phase: 'authenticating' })
  expect(retry.generation).toBeGreaterThan(pending.generation)
  expect(reduce_hosted(retry, late)).toBe(retry)
  // A completed authorization cannot be failed by a late answer.
  const authorizing = reduce_hosted(empty_hosted(), { type: 'start', phase: 'authorizing' })
  const complete = reduce_hosted(authorizing, {
    type: 'result',
    generation: authorizing.generation,
    values: { phase: 'complete' },
  })
  expect(
    reduce_hosted(complete, { type: 'result', generation: authorizing.generation, values: { phase: 'failed' } })
  ).toBe(complete)
  // The service has no implicit endpoint and must be a bare HTTPS origin.
  expect(resolve_bot_service_url()).toBe('')
  expect(resolve_bot_service_url('https://bot.example/')).toBe('https://bot.example')
  const refused = [
    'http://bot.example',
    'https://user:secret@bot.example',
    'https://bot.example/path',
    'https://bot.example/?key=secret',
  ]
  refused.forEach((url) => expect(() => resolve_bot_service_url(url)).toThrow())
})

test("a hosted bot's custody is proven for this request alone before the player's wallet trusts it", async () => {
  // Public test identities only: a fixed agent key and a synthetic Google identity, no chain call.
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const member = {
    public_key: key.getPublicKey(),
    storage: 'persistent' as const,
    sign_personal_message: (bytes: Uint8Array) => key.signPersonalMessage(bytes),
    sign_transaction: async () => Promise.reject(new Error('No transactions')),
  }
  const request = (nonce: string) => ({
    version: 1 as const,
    network: 'mainnet' as const,
    nonce,
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  })
  const { signer } = await prepare_agent_pairing(request(crypto.randomUUID()), member)
  const bot = {
    id: 'bot',
    address: signer.address,
    multisig_public_key: signer.public_key.toBase64(),
    generation: 1,
    policy_revision: 1,
    status: 'ready' as const,
  }
  const wallet = fake_wallet({ read_agent_pairing_request: request }, google.toSuiAddress())
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  const app = { get_state: read_app_state, dispatch: dispatch_app }
  const bot_service = (answer: Readonly<{ pending: number; replayed?: boolean }>) => {
    const state = { ...answer, proofs: 0 }
    const fetcher = (async (_url: URL, init: RequestInit) => {
      state.proofs += 1
      if (state.pending > 0) {
        state.pending -= 1
        return Response.json({ status: 'pending' })
      }
      const asked = JSON.parse(String(init.body)).request
      const signed = state.replayed ? { ...asked, nonce: crypto.randomUUID() } : asked
      return Response.json({ status: 'ready', proof: (await prepare_agent_pairing(signed, member)).response })
    }) as unknown as typeof fetch
    return { state, client: create_hosted_client('https://bot.example', new AbortController().signal, app, fetcher) }
  }
  // The bot holds the request until it signs; each pending answer is asked again at once.
  const patient = bot_service({ pending: 2 })
  await expect(verify_hosted_bot(patient.client, wallet, 'request', bot)).resolves.toMatchObject({
    identity: { address: bot.address },
  })
  expect(patient.state.proofs).toBe(3)
  // An old answer, signed for another nonce, never stands in for this check.
  const replayed = bot_service({ pending: 0, replayed: true })
  await expect(verify_hosted_bot(replayed.client, wallet, 'request', bot)).rejects.toThrow()
  // A proof for another signer than the bot the service described is refused.
  await expect(
    verify_hosted_bot(bot_service({ pending: 0 }).client, wallet, 'request', { ...bot, address: `0x${'9'.repeat(64)}` })
  ).rejects.toThrow('Hosted descriptor mismatch')
  await expect(
    verify_hosted_bot(bot_service({ pending: 0 }).client, wallet, 'request', { ...bot, status: 'paused' as never })
  ).rejects.toThrow('Hosted signer unavailable')
})

test("the agent's SuiNS name is written only after the player confirms the review, once, and only for a verified owner", async () => {
  const pairing = {
    address: `0x${'2'.repeat(64)}`,
    multisig_public_key: 'fixture',
    signer_mode: 'host-persistent',
  } as const
  const calls: string[] = []
  const pause = { gate: null as Promise<void> | null, guard: null as (() => void) | null }
  const naming = (owner: string) =>
    fake_wallet({
      read_agent_pairing_request: () => ({ owner }),
      suins: {
        managed: true,
        snapshot: async () => ({ default_name: 'aresrpg.child.sceat.sui', names: [] }),
        set_default: async (_name: string, guard: () => void) => (guard(), void calls.push('default')),
        validate_parent: async (_name: string, guard: () => void) => {
          calls.push('validate')
          pause.guard = guard
          if (pause.gate) await pause.gate
          guard()
        },
        review_parent: async (_name: string, agent: string, guard: () => void, player: string) => (
          guard(),
          {
            fingerprint: 'review',
            player_address: player,
            agent_address: agent,
            erased_names: ['aresrpg.child.sceat.sui'],
            unchanged: false,
          }
        ),
        apply_parent: async (name: string, _agent: string, guard: () => void) => (
          guard(),
          calls.push('human'),
          { name: `aresrpg.${name}` }
        ),
      },
      set_agent_default: async (_pairing: unknown, _name: string, guard: () => void) => (
        guard(),
        void calls.push('agent')
      ),
      read_agent_balances: async () => ({ sui_balance_mist: 0n }),
    })
  const wallet = naming(`0x${'a'.repeat(64)}`)
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  // The review waits for the player: a cancel retires it and a late confirmation writes nothing.
  site.dispatch({ type: 'suins/setup', pairing, token: 'cancel' })
  await settle(5)
  expect(site.state().suins.request).toMatchObject({ stage: 'review' })
  site.dispatch({ type: 'suins/cancel' })
  site.dispatch({ type: 'suins/confirm' })
  await settle(5)
  expect(calls).toEqual(['validate'])
  // Two confirmations of one review apply it once: the player's name, then the agent's.
  site.dispatch({ type: 'suins/setup', pairing, token: 'apply' })
  await settle(5)
  site.dispatch({ type: 'suins/confirm' })
  site.dispatch({ type: 'suins/confirm' })
  await settle(5)
  expect(calls).toEqual(['validate', 'validate', 'human', 'agent'])
  // Signing out during a validation cancels its signer guard: nothing more is written.
  pause.gate = new Promise(() => {})
  site.dispatch({ type: 'suins/setup', pairing, token: 'interrupted' })
  await settle(5)
  site.dispatch({ type: 'auth/disconnected' })
  expect(() => pause.guard!()).toThrow('cancelled')
  expect(calls).toHaveLength(5)
  // A managed flag cannot stand in for a verified zkLogin owner.
  const other = await start_surface(SITE_MODULES, { seat: false, account: { wallet: naming('0xwrong') } })
  running.push(other)
  await sign_in(other)
  other.dispatch({ type: 'suins/setup', pairing, token: 'foreign' })
  await settle(5)
  expect(calls).toHaveLength(5)
  expect(other.state().suins.error).toBe('unsupported')
})

test('Connect waits until the agent naming ends, and a refusal or a leaving page releases it', async () => {
  const pairing = {
    address: `0x${'2'.repeat(64)}`,
    multisig_public_key: 'fixture',
    signer_mode: 'host-persistent',
  } as const
  const wallet = fake_wallet({
    read_agent_pairing_request: () => ({ owner: `0x${'a'.repeat(64)}` }),
    suins: {
      managed: true,
      snapshot: async () => ({ default_name: 'aresrpg.child.sceat.sui', names: [] }),
      validate_parent: async (_name: string, guard: () => void) => guard(),
      review_parent: async (_name: string, agent: string, guard: () => void, player: string) => (
        guard(),
        { fingerprint: 'review', player_address: player, agent_address: agent, erased_names: [], unchanged: false }
      ),
    },
  })
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  // The naming waits on the player's review: Connect may not go on.
  const page = new AbortController()
  const ended = { value: false }
  const ready = begin_setup_name(wallet, page.signal)(pairing).then(() => void (ended.value = true))
  await settle(5)
  expect(site.state().suins.request).toMatchObject({ stage: 'review' })
  expect(ended.value).toBe(false)
  // The player declines the review: the naming has ended, so Connect continues.
  site.dispatch({ type: 'suins/cancel' })
  await ready
  expect(ended.value).toBe(true)
  // A page that leaves before the naming ends releases its barrier too, and the setup is cancelled.
  const leaving = new AbortController()
  const second = begin_setup_name(wallet, leaving.signal)(pairing)
  await settle(5)
  leaving.abort()
  await second
  expect(site.state().suins.request).toBeNull()
})
