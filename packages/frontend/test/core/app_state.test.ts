// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS, type CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({ quality: 'medium', flat_mode: false } as const)
const create_state = () => initial_app_state(settings)
const auth_session = (address = '0xowner'): AuthSession =>
  Object.freeze({
    address,
    wallet_name: 'Google',
    sign_personal_message: async () => ({ bytes: '', signature: '' }),
    read_sui_balance: async () => 0n,
    gas_spent_24h: () => 0n,
    derive_character_id: () => '0xcharacter',
    is_character_name_claimed: async () => false,
    resolve_suins_address: async () => null,
    estimate_sui_transfer: async () => 0n,
    send_sui: async () => ({ digest: null }),
    create_seed_admin: async () => {
      throw new Error('unused in reducer tests')
    },
    read_marketplace_royalties: async () => [],
    claim_marketplace_royalties: async () => ({ digest: '', amount_mist: 0n, policies: [] }),
    disconnect: async () => undefined,
  })
const connect = (address = '0xowner') =>
  reduce_app_state(reduce_app_state(create_state(), { type: 'auth/connecting' }), {
    type: 'auth/connected',
    session: auth_session(address),
  })

const character = (id: string): CharacterRow => ({
  id,
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 1,
  color_1: 0xffffff,
  color_2: 0xd9af57,
  color_3: 0x8b6539,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  kiosk: '0xkiosk',
  equipment: [],
})

describe('app state', () => {
  test('login never guesses an empty roster before the server snapshot', () => {
    const authenticated = connect()

    expect(authenticated.session.wallet?.address).toBe('0xowner')
    expect(authenticated.session.roster_loaded).toBeFalse()
    expect(authenticated.navigation.dialog).toBeNull()
  })

  test('rejected duplicate auth commands cannot trigger a second effect edge', () => {
    const ready = reduce_app_state(create_state(), { type: 'auth/ready', wallets: ['Sui Wallet'] })
    const connecting = reduce_app_state(ready, { type: 'auth/login_wallet', name: 'Sui Wallet' })
    const connected = reduce_app_state(connecting, { type: 'auth/connected', session: auth_session() })

    expect(reduce_app_state(connecting, { type: 'auth/login_wallet', name: 'Sui Wallet' })).toBe(connecting)
    expect(reduce_app_state(connected, { type: 'auth/connected', session: auth_session('0xlate') })).toBe(connected)
  })

  test('the authoritative empty roster opens welcome, then creation', () => {
    const loaded = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/characters', characters: [] },
    })

    expect(loaded.session.roster_loaded).toBeTrue()
    expect(loaded.navigation.dialog).toBe('welcome')
    expect(reduce_app_state(loaded, { type: 'dialog/open', dialog: 'character_create' }).navigation.dialog).toBe(
      'character_create'
    )
  })

  test('a roster selects one character without opening the empty-state dialog', () => {
    const loaded = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/characters', characters: [character('0xcharacter')] },
    })

    expect(loaded.session.selected_character_id).toBe('0xcharacter')
    expect(loaded.navigation.dialog).toBeNull()
  })

  test('server facts and display settings fold through the same reducer', () => {
    const online = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/server_info', online: 42 },
    })
    expect(online.session.online).toBe(42)
  })

  test('logout clears account truth but retains device settings', () => {
    const configured = connect()
    const logged_out = reduce_app_state(configured, { type: 'auth/disconnected' })

    expect(logged_out.session.wallet).toBeNull()
    expect(logged_out.session.characters).toEqual([])
    expect(logged_out.session.inventory).toEqual([])
    expect(logged_out.settings).toEqual(settings)
  })

  test('a rejected restored identity returns to login without stale account truth', () => {
    const configured = connect()
    const rejected = reduce_app_state(configured, { type: 'auth/rejected', error: 'Session expired' })

    expect(rejected.session.wallet).toBeNull()
    expect(rejected.session.auth_status).toBe('idle')
    expect(rejected.session.auth_error).toBe('Session expired')
    expect(rejected.navigation).toEqual({ page: 'world', pathname: '/', dialog: null, guest_spectating: false })
  })

  test('only the publisher wallet can open admin and only the next inspected batch can execute', () => {
    const outsider = reduce_app_state(create_state(), { type: 'page/open', page: 'admin' })
    expect(outsider.navigation.page).toBe('world')

    const authenticated = connect(DEFAULT_ADMIN_ADDRESS)
    const opened = reduce_app_state(authenticated, { type: 'page/open', page: 'admin' })
    const loading = reduce_app_state(opened, { type: 'admin/refresh' })
    const ready = reduce_app_state(loading, {
      type: 'admin/refreshed',
      snapshot: {
        batches: [
          { id: 'items:0', phase: 'items', state: 'ready', targets: 10, missing_dependencies: [] },
          { id: 'items:1', phase: 'items', state: 'pending', targets: 10, missing_dependencies: [] },
        ],
        sealed: false,
      },
    })

    expect(opened.navigation.page).toBe('admin')
    expect(reduce_app_state(ready, { type: 'admin/execute', batch: 'items:1' })).toBe(ready)
    const executing = reduce_app_state(ready, { type: 'admin/execute', batch: 'items:0' })
    expect(executing.admin.operation).toEqual({
      type: 'batch',
      batch: 'items:0',
    })
    expect(
      reduce_app_state(executing, {
        type: 'admin/batch_succeeded',
        batch: 'items:1',
        snapshot: { batches: [], sealed: false },
      })
    ).toBe(executing)
  })

  test('the separate admin signer stores identity, not transaction progress', () => {
    const available = reduce_app_state(create_state(), { type: 'admin/wallets_loaded', wallets: ['Sui Wallet'] })
    const connecting = reduce_app_state(available, { type: 'admin/wallet_connect', wallet_name: 'Sui Wallet' })
    const session = auth_session('0xadmin')
    const connected = reduce_app_state(connecting, { type: 'admin/wallet_connected', session })

    expect(connected.admin.wallet).toEqual({
      status: 'connected',
      wallets: ['Sui Wallet'],
      requested_wallet: null,
      session,
      error: null,
    })
    expect(reduce_app_state(connecting, { type: 'admin/wallet_connect', wallet_name: 'Sui Wallet' })).toBe(connecting)
    expect(reduce_app_state(connected, { type: 'admin/wallet_disconnect' }).admin.wallet.status).toBe('connecting')
  })

  test('correlated request errors do not become connection errors', () => {
    const state = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/error', id: 7, reason: 'character not found' },
    })
    expect(state.session.link_error).toBeNull()
  })
})
