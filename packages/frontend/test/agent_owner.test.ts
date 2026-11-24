// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The player's view of its own agent through the site's real store: only a validated owner answer connects it,
// only the current wallet's explicit choice makes it the inventory target, the agent's bag folds by version and
// target, and a hero is sent only while the wallet, the target and the hero itself are still what was reviewed.
import { afterEach, expect, test } from 'bun:test'
import type { AgentPairingIdentity, CharacterRow, HostedOwnerStatus, ItemRow } from '@aresrpg/protocol'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { create_agent_identity } from '@aresrpg/sdk/agent-multisig'
import type { AgentTransferActions } from '@aresrpg/sdk/agent-transfer-actions'

import { execute_agent_transfer } from '../src/agents/agent_transaction.ts'
import { character_send_current, character_send_eligible } from '../src/agents/character_send.ts'
import { owner_answer, owner_checkable, owner_connected, owner_reachable } from '../src/agents/owner_state.ts'
import type { AuthSession } from '../src/auth.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { character_row, fake_wallet, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const pairing: AgentPairingIdentity = {
  address: 'agent',
  multisig_public_key: 'descriptor',
  signer_mode: 'host-persistent',
}
const owner_status = (owner: string, status: 'connected' | 'disconnected' = 'connected'): HostedOwnerStatus => ({
  owner,
  status,
  expires_at: status === 'connected' ? Date.now() + 60_000 : null,
  recovery_bots: [],
  bot: { id: 'bot', ...pairing, status: 'ready', generation: 1, policy_revision: 1 },
})
const start_site = async (wallet: AuthSession): Promise<Started> => {
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  await sign_in(site)
  return site
}

test('only a validated owner answer connects the agent; late, cancelled or foreign answers change nothing', async () => {
  const wallet = fake_wallet({ read_agent_balances: async () => ({ sui_balance_mist: 0n, kares_balance: null }) })
  const site = await start_site(wallet)
  const session = () => site.state().session
  // Before any answer the owner reads unknown, never "not connected"; a check that cannot run reads not connected.
  expect(owner_answer(session(), true)).toBe('unknown')
  expect(owner_answer(session(), false)).toBe('not_connected')
  // A remembered pairing is a candidate only.
  site.dispatch({ type: 'agent/pairing_verified', wallet, pairing: { ...pairing, signer_mode: 'disposable' } })
  expect(owner_connected(session())).toBe(false)
  site.dispatch({ type: 'agent/connection_refresh' })
  const checking = session().agent_connection.generation
  const result = (generation: number, response: HostedOwnerStatus, from = wallet) =>
    ({
      type: 'agent/connection_result',
      failure: null,
      wallet: from,
      generation,
      response,
      pairing: response.status === 'connected' ? pairing : null,
    }) as const
  // An answer for another wallet object is refused.
  site.dispatch(result(checking, owner_status(wallet.address), { ...wallet } as AuthSession))
  expect(owner_answer(session(), true)).toBe('unknown')
  site.dispatch(result(checking, owner_status(wallet.address)))
  expect(owner_connected(session())).toBe(true)
  expect(session().inventory_pairing).toEqual(pairing)
  expect(session().agent_pairing_candidate).toBeNull()
  // A re-check keeps the answer it has until the new one arrives; a revoked grant stops the target.
  site.dispatch({ type: 'agent/connection_refresh' })
  expect(owner_answer(session(), true)).toBe('connected')
  site.dispatch(result(session().agent_connection.generation, owner_status(wallet.address, 'disconnected')))
  expect(owner_connected(session())).toBe(false)
  expect(session().inventory_pairing).toBeNull()
  // A cancelled check or a sign-out refuses its late answer.
  site.dispatch({ type: 'agent/connection_refresh' })
  const cancelled = session().agent_connection.generation
  site.dispatch({ type: 'agent/connection_cancel' })
  site.dispatch(result(cancelled, owner_status(wallet.address)))
  expect(owner_connected(session())).toBe(false)
  // Who can be checked: a Google account with a bot service; with none it reads unreachable, never not connected.
  const google = { identity: 'zklogin' } as const
  expect([
    owner_checkable(google, 'https://bot.example', ''),
    owner_checkable(google, '', ''),
    owner_checkable({ identity: 'wallet' }, 'https://bot.example', ''),
  ]).toEqual([true, false, false])
  expect(owner_checkable(google, 'https://bot.example', '?intent=connect-agent&authorization_id=request')).toBe(false)
  expect([owner_reachable(google, ''), owner_reachable(google, 'https://bot.example')]).toEqual([false, true])
  expect(owner_answer(session(), false, false)).toBe('unreachable')
})

test("the inventory target is the current wallet's explicit choice, and the agent's bag folds by version and by target", async () => {
  const wallet = fake_wallet({ read_agent_balances: async () => ({ sui_balance_mist: 0n, kares_balance: null }) })
  const site = await start_site(wallet)
  const session = () => site.state().session
  // Watching an agent never makes it the target; another wallet object cannot choose one.
  site.dispatch({ type: 'agent/watch', observation: { pairing, public_identifier: 'google', character_id: null } })
  expect(session().inventory_pairing).toBeNull()
  site.dispatch({ type: 'agent/inventory_target', wallet: { ...wallet } as AuthSession, pairing })
  expect(session().inventory_pairing).toBeNull()
  // A verified proof is a candidate until the player compares it; a replacement revokes the target.
  site.dispatch({ type: 'agent/pairing_verified', wallet, pairing })
  expect(session()).toMatchObject({ agent_pairing_candidate: pairing, inventory_pairing: null })
  site.dispatch({ type: 'agent/inventory_target', wallet, pairing })
  expect(session()).toMatchObject({ agent_pairing_candidate: null, inventory_pairing: pairing })
  expect(Object.isFrozen(session().inventory_pairing)).toBe(true)
  // The agent's bag: a newer version wins, a removal is a tombstone, the player's own bag is untouched.
  const ore: ItemRow = {
    id: 'ore',
    version: '1',
    kiosk: 'agent-kiosk',
    item_type: 'ore',
    category: 'resource',
    name: 'Ore',
    amount: 3,
    level: 1,
  }
  const own_bag = session().inventory
  const observed = (packet: Readonly<Record<string, unknown>>, id = session().agent_inventory.serial) =>
    site.receive({ type: 'packet/inventory_observed', id, packet })
  observed({ type: 'packet/inventory', items: [ore] })
  observed({ type: 'packet/item_updated', item: { ...ore, version: '3', amount: 9 } })
  observed({ type: 'packet/inventory', items: [ore] })
  expect(session().agent_inventory.inventory).toEqual([{ ...ore, version: '3', amount: 9 }])
  observed({ type: 'packet/item_removed', item: ore.id, version: '4' })
  observed({ type: 'packet/item_updated', item: { ...ore, version: '3' } })
  expect(session().agent_inventory.inventory).toEqual([])
  expect(session().inventory).toBe(own_bag)
  // A replaced target refuses the earlier target's late bag and balances.
  const earlier = session().agent_inventory.serial
  site.dispatch({ type: 'agent/inventory_target', wallet, pairing: { ...pairing, address: 'second' } })
  observed({ type: 'packet/inventory', items: [ore] }, earlier)
  site.dispatch({ type: 'agent/inventory_balances', wallet, pairing, sui_balance_mist: 10n, kares_balance: 20n })
  expect(session().agent_inventory).toMatchObject({ inventory: [], sui_balance_mist: null })
  // A disposable pairing stays disposable; signing out clears the target and the candidate.
  site.dispatch({ type: 'agent/inventory_target', wallet, pairing: { ...pairing, signer_mode: 'disposable' } })
  expect(session().inventory_pairing?.signer_mode).toBe('disposable')
  site.dispatch({ type: 'auth/disconnected' })
  expect(site.state().session).toMatchObject({ inventory_pairing: null, agent_pairing_candidate: null })
})

test('a hero is sent to the agent only while the wallet, the persistent target and the hero are still the reviewed ones', async () => {
  const google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
  const identity = create_agent_identity({
    agent_public_key: new Ed25519PublicKey(new Uint8Array(32).fill(3)),
    zklogin_public_identifier: google,
  })
  const target: AgentPairingIdentity = {
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    signer_mode: 'host-persistent',
  }
  const wallet = fake_wallet(
    {
      read_agent_balances: async () => ({ sui_balance_mist: 0n, kares_balance: null }),
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
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet } })
  running.push(site)
  const clicked: CharacterRow = character_row('clicked-second', { kiosk: 'clicked-kiosk', custody: 'kiosk' })
  await sign_in(site, { characters: [character_row('first', { custody: 'kiosk' }), clicked] })
  site.dispatch({ type: 'character/select', character_id: 'first' })
  site.dispatch({ type: 'agent/inventory_target', wallet, pairing: target })
  const { session } = site.state()
  // The clicked hero is sent, not the first or the selected one, and only to an explicit persistent target.
  expect(character_send_current(session, wallet, target, clicked)).toBe(true)
  expect(
    character_send_current(
      { ...session, inventory_pairing: null, agent_pairing_candidate: target },
      wallet,
      target,
      clicked
    )
  ).toBe(false)
  expect(character_send_current(session, { ...wallet } as AuthSession, target, clicked)).toBe(false)
  expect(character_send_current(session, wallet, { ...target, signer_mode: 'disposable' }, clicked)).toBe(false)
  expect([character_send_eligible({ ...clicked, custody: 'fight' }), character_send_eligible(clicked)]).toEqual([
    false,
    true,
  ])
  // Any change while the wallet prepares the offer stops it before a signature.
  const changes: readonly (Partial<typeof session> & Readonly<Record<string, unknown>>)[] = [
    { wallet: { ...wallet } as AuthSession },
    { inventory_pairing: { ...target, address: 'other' } },
    { characters: [{ ...clicked, custody: 'fight' }] },
    { characters: [{ ...clicked, kiosk: 'other' }] },
    { characters: [] },
  ]
  const confirmations: string[] = []
  const attempts = changes.map(async (change) => {
    const current = { value: session }
    const actions = {
      prepare: async () => {
        current.value = { ...session, ...change }
        return { confirm: async () => (confirmations.push('signed'), { digest: 'never' }) }
      },
    } as unknown as AgentTransferActions
    const intent = { kind: 'offer', character_id: clicked.id, kiosk: clicked.kiosk, recipient: target.address } as const
    return execute_agent_transfer({
      actions,
      intent,
      is_current: () => character_send_current(current.value, wallet, target, clicked),
    }).then(
      () => 'sent',
      () => 'refused'
    )
  })
  expect(await Promise.all(attempts)).toEqual(changes.map(() => 'refused'))
  expect(confirmations).toEqual([])
})
