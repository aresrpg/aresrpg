// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Custody: what the player's wallet may sign for a hosted agent, what moves between the player and the agent,
// the giftcards a holder wallet hands over, and the wallet import. Nothing signs what the player did not review.
import { afterEach, expect, test } from 'bun:test'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { create_agent_identity, create_agent_multisig } from '@aresrpg/sdk/agent-multisig'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'
import type { AgentInventoryItem } from '@aresrpg/sdk/agent-inventory'
import type { AgentTransferActions } from '@aresrpg/sdk/agent-transfer-actions'
import type { WalletImportPlan } from '@aresrpg/sdk/wallet-import'

import { execute_agent_transfer } from '../src/agents/agent_transaction.ts'
import {
  hosted_consent_destination,
  sign_hosted_message,
  type HostedSigningIntent,
} from '../src/agents/hosted_challenge.ts'
import {
  coin_transfer_intent,
  item_return_group,
  pending_inventory_transfer,
  selected_transfer_items,
} from '../src/agents/inventory_transfer.ts'
import { item_claim_attempts } from '../src/agents/item_recovery.ts'
import { read_agent_identities, remember_agent_identity } from '../src/agents/pairing_storage.ts'
import type { AuthSession } from '../src/auth.ts'
import { rolled_item_types } from '../src/content/item_templates.ts'
import { create_claim_attempts, create_giftcard_attempts } from '../src/modules/giftcard_attempts.ts'
import {
  agent_funding_authorization,
  funding_recipient_current,
  recall_funding_authorization,
} from '../src/funding/recipient.ts'
import { initial_session_state, type SessionState } from '../src/modules/session.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { character_row, fake_wallet, memory_storage, settle, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const start_site = async (wallet: AuthSession): Promise<Started> => {
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  return site
}

const intent: HostedSigningIntent = {
  issuer: 'https://bot.fixture.example',
  web_origin: 'https://game.fixture.example',
  input: {
    purpose: 'consent',
    authorization_id: 'auth',
    owner: 'owner',
    zklogin_public_identifier: 'google',
    bot_id: 'bot',
    generation: 1,
    policy_revision: 2,
    address: 'address',
    multisig_public_key: 'public',
  },
  consent: {
    authorization_id: 'auth',
    client_id: 'client',
    client_name: 'Assistant',
    redirect_uri: 'https://assistant.fixture.example/callback',
    scopes: ['bot:observe'],
    resource: 'https://bot.fixture.example/mcp',
    network: 'mainnet',
  },
}
const reviewed = () => ({
  purpose: 'consent',
  issuer: intent.issuer,
  network: 'mainnet',
  authority_generation: 'generation',
  authorization_id: 'auth',
  session_hash: 'session',
  nonce: 'challenge',
  owner: 'owner',
  zklogin_public_identifier: 'google',
  client_id: 'client',
  redirect_uri: intent.consent!.redirect_uri,
  resource: intent.consent!.resource,
  scopes: ['bot:observe'],
  expires_at: Date.now() + 60_000,
  consent: { bot_id: 'bot', generation: 1, policy_revision: 2, address: 'address', multisig_public_key: 'public' },
})
const challenge = (
  value: ReturnType<typeof reviewed>,
  message = `AresRPG hosted bot consent v1\n${JSON.stringify(value)}`
) => ({
  authorization_id: 'auth',
  challenge_id: 'challenge',
  expires_at: value.expires_at,
  message,
})

test('a hosted consent signs the exact reviewed bytes once, and any substitution is refused before the wallet', async () => {
  const signed: string[] = []
  const sign = async (bytes: Uint8Array) => {
    signed.push(new TextDecoder().decode(bytes))
    return 'signature'
  }
  const exact = challenge(reviewed())
  expect(await sign_hosted_message(exact, intent, sign)).toBe('signature')
  expect(signed).toEqual([exact.message])
  const base = reviewed()
  const substitutions = [
    { consent: { ...base.consent, bot_id: 'other' } },
    { consent: { ...base.consent, address: 'other' } },
    { consent: { ...base.consent, multisig_public_key: 'other' } },
    { client_id: 'other' },
    { purpose: 'session' },
    { owner: 'other' },
    { resource: 'https://other.example/mcp' },
    { issuer: 'https://other.example' },
    { network: 'testnet' },
    { redirect_uri: 'https://other.example/callback' },
    { scopes: ['bot:execute'] },
    { nonce: 'other' },
  ]
  for (const patch of substitutions)
    await expect(sign_hosted_message(challenge({ ...base, ...patch }), intent, sign)).rejects.toThrow()
  await expect(sign_hosted_message(challenge(base, 'Authorize another application'), intent, sign)).rejects.toThrow()
  for (const expires_at of [Date.now() - 1, Date.now() + 600_000, Number.NaN])
    await expect(sign_hosted_message({ ...exact, expires_at }, intent, sign)).rejects.toThrow()
  for (const consent of [null, { ...intent.consent!, authorization_id: 'another-review' }])
    await expect(sign_hosted_message(exact, { ...intent, consent }, sign)).rejects.toThrow()
  expect(signed).toHaveLength(1)
  // The consent names the registered HTTPS destination, never the client's own branding.
  expect(hosted_consent_destination('https://receiver.example:8443/callback?state=value')).toBe('receiver.example:8443')
  expect(hosted_consent_destination('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('ChatGPT')
  for (const uri of [
    'http://receiver.example',
    'https://ChatGPT@receiver.example/callback',
    'https://receiver.example/#fake',
    'not a URL',
  ])
    expect(() => hosted_consent_destination(uri)).toThrow()
  for (const uri of [
    'https://chatgpt.com.attacker.example/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect?next=attacker',
  ])
    expect(hosted_consent_destination(uri)).not.toBe('ChatGPT')
})

test('a transfer to or from the agent is prepared and signed once, and a changed wallet or agent never signs', async () => {
  const offer = {
    kind: 'asset_offer' as const,
    items: [],
    recipient: 'agent',
    sui_mist: '1',
    kares_mist: '0',
    reserve_mist: '1',
  }
  const calls: string[] = []
  const once = {
    prepare: async () => {
      calls.push('prepare')
      return { confirm: async () => (calls.push('confirm'), { digest: 'receipt' }) }
    },
  } as unknown as AgentTransferActions
  await expect(
    execute_agent_transfer({
      actions: once,
      intent: offer,
      is_current: () => true,
      prepared: () => void calls.push('prepared'),
    })
  ).resolves.toMatchObject({ digest: 'receipt' })
  expect(calls).toEqual(['prepare', 'prepared', 'confirm'])
  // The session changes while the wallet prepares, or right before it signs: nothing is signed.
  let current = true
  const signatures: string[] = []
  const changing = {
    prepare: async () => ({
      confirm: async ({ before_sign }: { before_sign: () => void }) => {
        current = false
        before_sign()
        signatures.push('signed')
      },
    }),
  } as unknown as AgentTransferActions
  await expect(execute_agent_transfer({ actions: changing, intent: offer, is_current: () => current })).rejects.toThrow(
    'changed'
  )
  const dismissed = execute_agent_transfer({ actions: once, intent: offer, is_current: () => false })
  expect(pre_submission_failure(await dismissed.catch((error: unknown) => error))).toBe(true)
  expect(signatures).toEqual([])
  // An uncertain outcome stays uncertain: it never reads as unsubmitted.
  const uncertain = new Error('[sdk] transaction outcome unknown: digest')
  const failing = {
    prepare: async () => ({ confirm: async () => Promise.reject(uncertain) }),
  } as unknown as AgentTransferActions
  expect(
    await execute_agent_transfer({ actions: failing, intent: offer, is_current: () => true }).catch(
      (error: unknown) => error
    )
  ).toBe(uncertain)
  expect(pre_submission_failure(uncertain)).toBe(false)

  // What moves is exact: a whole visual stack in one kiosk, never a subset of a locked or versionless selection.
  const row = (id: string, amount: number, kiosk = 'kiosk'): AgentInventoryItem => ({
    item: { id, amount, kiosk, version: '1', item_type: 'wheat', name: 'Wheat', category: 'resource', level: 1 },
    status: 'available',
  })
  const rows = [row('small', 2), row('large', 5), row('other', 3, 'another')]
  expect(selected_transfer_items(rows, ['large'])?.map(({ item_id }) => item_id)).toEqual(['small', 'large'])
  expect(selected_transfer_items([row('a', 2), { ...row('locked', 1), status: 'listed' }], ['a', 'locked'])).toBeNull()
  expect(
    selected_transfer_items([{ ...row('a', 2), item: { ...row('a', 2).item, version: undefined } }], ['a'])
  ).toBeNull()
  expect(selected_transfer_items([row('small', 2), { ...row('locked', 9), exclusive: true }], ['locked'])).toBeNull()
  const coins = { token: 'sui' as const, amount: '0.000000001', reserve: '0', balance: 2n, recipient: 'agent' }
  expect(coin_transfer_intent(coins)).toMatchObject({
    recipient: 'agent',
    sui_mist: '1',
    kares_mist: '0',
    reserve_mist: '0',
  })
  for (const amount of ['0', '-1', '1e3', '0.0000000001', '0.000000003'])
    expect(coin_transfer_intent({ ...coins, amount })).toBeNull()
  expect(coin_transfer_intent({ ...coins, balance: null })).toBeNull()
  // An item on its way is never shown as owned by the destination until the server says it arrived.
  const moving = [row('moving', 2).item]
  const accounts = { player: 'player', agent: 'agent', player_items: moving, agent_items: [] }
  const pending = pending_inventory_transfer({ recipient: 'agent', items: moving }, true, accounts)
  expect(pending.agent_pending).toEqual(moving)
  expect(
    pending_inventory_transfer({ recipient: 'agent', items: moving }, false, {
      ...accounts,
      player_items: [],
      agent_items: moving,
    }).pending_ids.size
  ).toBe(0)
  expect(pending_inventory_transfer({ recipient: 'old-agent', items: moving }, true, accounts).agent_pending).toEqual(
    []
  )
})

test('recovery remembers who it tried, never retries a cap automatically, and never restores a signer', () => {
  const storage = memory_storage()
  const item = {
    agent_address: 'source',
    recipient: 'recipient',
    seller_kiosk: 'kiosk',
    item_id: 'item',
    purchase_cap: 'cap',
  }
  const attempts = item_claim_attempts(storage, 'owner')
  attempts.begin([item], false)
  expect(attempts.status(item)).toBe('attempted')
  expect(() => item_claim_attempts(storage, 'owner').begin([item], true)).toThrow('reconciliation')
  expect(attempts.status({ ...item, recipient: 'foreign' })).toBeUndefined()
  expect(item_claim_attempts(storage, 'another-owner').status(item)).toBeUndefined()
  const unreadable = { ...memory_storage(), getItem: () => '{' }
  expect(() => item_claim_attempts(unreadable, 'owner').begin([item], true)).toThrow()
  const selected = { ...item, offer_digest: 'drag' }
  const companion = { ...selected, item_id: 'second', purchase_cap: 'second' }
  expect(
    item_return_group([selected, companion, { ...selected, offer_digest: 'other', purchase_cap: 'other' }], selected)
  ).toEqual([selected, companion])
  // Saved pairings are public identities: a reload restores them as disposable, never as a signer.
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const request = {
    version: 1 as const,
    nonce: '11111111-1111-4111-8111-111111111111',
    network: 'mainnet' as const,
    owner: google.toSuiAddress(),
    zklogin_public_identifier: google.toBase64(),
  }
  const pairing = (fill: number) => {
    const identity = create_agent_multisig({
      agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(fill)),
      zklogin_public_identifier: google,
      sign_personal_message: async () => Promise.reject(new Error('no agent')),
    })
    return {
      address: identity.address,
      multisig_public_key: identity.public_key.toBase64(),
      signer_mode: 'host-persistent' as const,
    }
  }
  const saved = memory_storage()
  remember_agent_identity(saved, request, pairing(1))
  remember_agent_identity(saved, request, pairing(2))
  remember_agent_identity(saved, request, pairing(1))
  const restored = read_agent_identities(saved, request)
  expect(restored).toHaveLength(2)
  expect(restored.every(({ signer_mode }) => signer_mode === 'disposable')).toBe(true)
  expect(read_agent_identities(saved, { ...request, owner: 'other' })).toEqual([])
  expect(() => remember_agent_identity(null, request, pairing(1))).toThrow('storage')
})

test("funds reach an agent only while the server-accepted observation and the Google owner's proof still hold", () => {
  const wallet = fake_wallet()
  const watching: SessionState = {
    ...initial_session_state(),
    wallet,
    link_status: 'ready',
    selected_character_id: 'remote',
    agent_view: {
      ...initial_session_state().agent_view,
      serial: 3,
      status: 'ready',
      characters: [character_row('remote')],
      request: {
        character_id: 'remote',
        public_identifier: 'google',
        pairing: { address: 'agent', multisig_public_key: 'public', signer_mode: 'disposable' },
      },
    } as SessionState['agent_view'],
  }
  expect(funding_recipient_current(watching, wallet.address)).toBe(true)
  expect(funding_recipient_current(watching, 'agent')).toBe(false)
  const authorization = agent_funding_authorization(watching)!
  expect(funding_recipient_current(watching, 'agent', authorization)).toBe(true)
  for (const changed of [
    { ...watching, wallet: null },
    { ...watching, wallet: { ...wallet } as AuthSession },
    { ...watching, selected_character_id: 'another' },
    { ...watching, link_status: 'connecting' as const },
    { ...watching, agent_view: { ...watching.agent_view, serial: 4 } },
    { ...watching, agent_view: { ...watching.agent_view, status: 'loading' as const } },
  ])
    expect(funding_recipient_current(changed, 'agent', authorization)).toBe(false)
  // Recall funds only the canonical multisig of the account's own Google identity.
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const identity = create_agent_identity({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(1)),
    zklogin_public_identifier: google,
  })
  const pairing = {
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: 'disposable' as const,
  }
  const owner = fake_wallet(
    {
      read_agent_pairing_request: (nonce: string) => ({
        version: 1,
        nonce,
        network: 'mainnet',
        owner: google.toSuiAddress(),
        zklogin_public_identifier: google.toBase64(),
      }),
    },
    google.toSuiAddress()
  )
  const recovering = { ...initial_session_state(), wallet: owner }
  const recall = recall_funding_authorization(recovering, pairing)!
  expect(funding_recipient_current(recovering, pairing.address, recall)).toBe(true)
  expect(funding_recipient_current(recovering, 'arbitrary', recall)).toBe(false)
  expect(recall_funding_authorization(recovering, { ...pairing, address: google.toSuiAddress() })).toBeNull()
  expect(
    recall_funding_authorization({ ...recovering, wallet: { ...owner, identity: 'wallet' } as AuthSession }, pairing)
  ).toBeNull()
  const send = { ...recall, require_inventory_pairing: true }
  expect(funding_recipient_current({ ...recovering, inventory_pairing: pairing }, pairing.address, send)).toBe(true)
  expect(funding_recipient_current({ ...recovering, inventory_pairing: null }, pairing.address, send)).toBe(false)
})

test('a holder wallet hands every voucher over in one batch, the game wallet redeems once, and a failure is not retried', async () => {
  const [template] = [...rolled_item_types()].find(([, type]) => type === 'wheat_barley')!
  const cards = [
    { id: '0xa', template, amount: 2 },
    { id: '0xb', template, amount: 3 },
  ]
  const transfers: unknown[] = []
  const redemptions: unknown[] = []
  const holder = {
    address: '0xexternal',
    read_giftcards: async () => cards,
    transfer_giftcards: async (rows: unknown) => {
      transfers.push(rows)
      return { digest: 'transfer-batch', giftcards: cards }
    },
    disconnect: async () => undefined,
  }
  const wallet = fake_wallet({
    redeem_giftcards: async (rows: unknown) => {
      redemptions.push(rows)
      return { digest: 'redeem-batch' }
    },
    read_giftcards: async () => [],
  })
  const site = await start_site(wallet)
  site.dispatch({ type: 'distribution/viewed', open: true })
  site.dispatch({
    type: 'external_wallet/connected',
    sequence: site.state().external_wallet.sequence,
    session: holder as never,
  })
  await settle(5)
  site.dispatch({ type: 'distribution/claim_all' })
  await settle(5)
  expect(transfers).toEqual([cards.map(({ id }) => ({ id, recipient: wallet.address }))])
  expect(redemptions).toEqual([cards])
  expect(site.state().session.giftcards).toEqual([])
  expect(site.state().distribution.holder_giftcards).toEqual([])
  // A redemption whose outcome is uncertain stays held and is not tried again on every snapshot.
  let attempts = 0
  const unlucky = fake_wallet({
    redeem_giftcards: async () => {
      attempts += 1
      throw new Error('transaction outcome uncertain')
    },
    read_giftcards: async () => [],
  })
  const other = await start_site(unlucky)
  other.dispatch({ type: 'distribution/viewed', open: true })
  for (let count = 0; count < 3; count += 1) {
    other.receive({ type: 'packet/giftcards', giftcards: [cards[0]!] })
    await settle(5)
  }
  expect(attempts).toBe(1)
  expect(other.state().session.giftcards).toEqual([cards[0]])
})

test('the wallet import reads the connected wallet, runs once, refuses late results, and says why it failed', async () => {
  const plan = {
    characters: [],
    items: [],
    pending: { characters: [], items: [] },
    left: { roster: 1, listed: 0 },
    assets: 3,
    royalty_mist: 3_000_000n,
  } as WalletImportPlan
  const reads: string[] = []
  const wallet = fake_wallet({
    read_wallet_import: async (source: AuthSession) => {
      reads.push(source.address)
      return plan
    },
    import_wallet_assets: async () => Promise.reject(new Error('import refused')),
  })
  const site = await start_site(wallet)
  site.dispatch({ type: 'wallet_import/open' })
  expect(site.state().wallet_import).toMatchObject({ open: true, source: null, step: { kind: 'idle' } })
  // An import cannot run before the wallet was read.
  site.dispatch({ type: 'wallet_import/start' })
  expect(site.state().wallet_import.step.kind).toBe('idle')
  const source = fake_wallet({ wallet_name: 'Slush', identity: 'wallet' }, `0x${'b'.repeat(64)}`)
  site.dispatch({
    type: 'external_wallet/connected',
    sequence: site.state().external_wallet.sequence,
    session: source as never,
  })
  await settle(5)
  expect(reads).toEqual([source.address])
  expect(site.state().wallet_import).toMatchObject({ source, step: { kind: 'ready', plan } })
  // A late read of an earlier operation is refused.
  const ready = site.state().wallet_import
  site.dispatch({ type: 'wallet_import/loaded', sequence: ready.sequence - 1, plan })
  expect(site.state().wallet_import).toBe(ready)
  site.dispatch({ type: 'wallet_import/start' })
  // A late read failure cannot end a running import.
  const running_import = site.state().wallet_import
  site.dispatch({ type: 'wallet_import/failed', sequence: running_import.sequence - 1, error: { kind: 'busy' } })
  expect(site.state().wallet_import.step.kind).toBe('importing')
  // A running import cannot be closed or re-read: the signer keeps going.
  site.dispatch({ type: 'wallet_import/close' })
  site.dispatch({ type: 'wallet_import/refresh' })
  expect(site.state().wallet_import).toMatchObject({ open: true, step: { kind: 'importing' } })
  await settle(5)
  expect(site.state().wallet_import.step.kind).toBe('failed')
  // A retry reads the wallet again; closing resets the window.
  site.dispatch({ type: 'wallet_import/refresh' })
  await settle(5)
  expect(reads).toHaveLength(2)
  site.dispatch({ type: 'wallet_import/close' })
  expect(site.state().wallet_import).toMatchObject({ open: false, source: null, step: { kind: 'idle' } })
})

test('a giftcard redemption is tried once automatically, even across reloads, and only the player retries it', async () => {
  const [template] = [...rolled_item_types()].find(([, type]) => type === 'wheat_barley')!
  const card = { id: '0xcard', template, amount: 1 }
  const storage = memory_storage()
  const attempts: string[] = []
  const wallet = fake_wallet({
    read_giftcards: async () => [],
    redeem_giftcards: async () => {
      // The marker is written before the wallet is asked, so a crash mid-signature cannot retry it.
      attempts.push([...storage.values.keys()].some((key) => key.includes('giftcard-attempt')) ? 'marked' : 'unmarked')
      throw new Error('transaction outcome uncertain')
    },
  })
  const load = async () => {
    const site = await start_surface(SITE_MODULES, {
      seat: false,
      account: { wallet, remembered: 'Sign in with Google' },
      storage,
    })
    running.push(site)
    await sign_in(site)
    site.dispatch({ type: 'distribution/viewed', open: true })
    site.receive({ type: 'packet/giftcards', giftcards: [card] })
    await settle(5)
    return site
  }
  await load()
  expect(attempts).toEqual(['marked'])
  const reloaded = await load()
  expect(attempts).toHaveLength(1)
  reloaded.dispatch({ type: 'distribution/redeem', giftcards: [card] })
  await settle(5)
  expect(attempts).toHaveLength(2)
  // Markers are scoped by network, account and card, whatever the hex case; unreadable or full storage stops automation.
  const values = memory_storage({ 'aresrpg:giftcard-attempt:testnet:0xab:0xcd': '1' })
  expect(create_giftcard_attempts(values, 'testnet').has('0xAB', '0xCD')).toBe(true)
  const claims = create_claim_attempts(values, 'testnet', 'claim')
  expect([claims.has('0xAB', '0xCD'), claims.remember('0xAB', '0xCD')]).toEqual([false, true])
  expect(create_claim_attempts(values, 'testnet', 'claim').has('0xab', '0xcd')).toBe(true)
  expect(create_claim_attempts(values, 'mainnet', 'claim').has('0xab', '0xcd')).toBe(false)
  const full = create_claim_attempts(
    {
      ...memory_storage(),
      setItem: () => {
        throw new Error('storage full')
      },
    },
    'testnet',
    'claim'
  )
  expect([full.has('0xa', '0xb'), full.remember('0xa', '0xb'), full.has('0xa', '0xb')]).toEqual([false, false, true])
  const unreadable = create_claim_attempts(
    {
      ...memory_storage(),
      getItem: () => {
        throw new Error('denied')
      },
    },
    'testnet',
    'claim'
  )
  expect([unreadable.has('0xa', '0xb'), unreadable.remember('0xa', '0xb')]).toEqual([true, false])
})
