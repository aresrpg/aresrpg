// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS, type CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true } as const)
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
    buy_shop_item: async () => ({ digest: '' }),
    claim_airdrop: async () => ({ digest: '' }),
    create_seed_admin: async () => {
      throw new Error('unused in reducer tests')
    },
    publish_contract: async () => ({ receipt: {}, objects: [] }),
    read_game_paused: async () => false,
    set_game_paused: async () => ({ digest: '' }),
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
  test('receipt-derived shop facts survive routed page changes without a transaction reducer', () => {
    const loaded = reduce_app_state(connect(), {
      type: 'server/packet',
      packet: {
        type: 'packet/shop_state',
        sales: [{ item_type: 'pet_lootbox', supply: '8' }],
        airdrops: [{ drop_id: 'founders', eligible: true, eligible_count: 2 }],
      },
    })
    const bought = reduce_app_state(loaded, { type: 'shop/purchased', item_type: 'pet_lootbox', quantity: 2 })
    const claimed = reduce_app_state(bought, { type: 'airdrop/claimed', drop_id: 'founders' })
    expect(claimed.session.shop).toEqual({
      sales: [{ item_type: 'pet_lootbox', supply: '6' }],
      airdrops: [{ drop_id: 'founders', eligible: false, eligible_count: 1 }],
    })
  })

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
      packet: { type: 'packet/server_info', online: 42, indexing_lag: 7 },
    })
    expect(online.session.online).toBe(42)
    expect(online.session.indexing_lag).toBe(7)
  })

  test('server latency is session truth and clears before reconnecting', () => {
    const admitted = reduce_app_state(connect(), {
      type: 'server/packet',
      packet: { type: 'packet/connection_accepted', address: '0xowner' },
    })
    const measured = reduce_app_state(admitted, { type: 'link/latency', latency_ms: 42 })
    const indexed = reduce_app_state(measured, {
      type: 'server/packet',
      packet: { type: 'packet/server_info', online: 42, indexing_lag: 12 },
    })
    const reconnecting = reduce_app_state(indexed, { type: 'link/failed', error: 'Connection lost' })

    expect(measured.session.latency_ms).toBe(42)
    expect(indexed.session.indexing_lag).toBe(12)
    expect(reconnecting.session.latency_ms).toBeNull()
    expect(reconnecting.session.indexing_lag).toBeNull()
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

  test('the separate admin signer requires an explicit provider and account choice', () => {
    const available = reduce_app_state(create_state(), { type: 'admin/wallets_loaded', wallets: ['Sui Wallet'] })
    const authorizing = reduce_app_state(available, { type: 'admin/wallet_connect', wallet_name: 'Sui Wallet' })
    const choosing = reduce_app_state(authorizing, {
      type: 'admin/wallet_accounts_loaded',
      accounts: ['0xfirst', '0xadmin'],
    })
    const connecting = reduce_app_state(choosing, { type: 'admin/wallet_account_select', address: '0xadmin' })
    const session = auth_session('0xadmin')
    const connected = reduce_app_state(connecting, { type: 'admin/wallet_connected', session })

    expect(connected.admin.wallet).toEqual({
      status: 'connected',
      wallets: ['Sui Wallet'],
      requested_wallet: null,
      accounts: [],
      requested_address: null,
      session,
      error: null,
    })
    expect(choosing.admin.wallet.status).toBe('selecting')
    expect(choosing.admin.wallet.accounts).toEqual(['0xfirst', '0xadmin'])
    expect(connecting.admin.wallet.requested_address).toBe('0xadmin')
    expect(reduce_app_state(choosing, { type: 'admin/wallet_account_select', address: '0xother' })).toBe(choosing)
    expect(reduce_app_state(connected, { type: 'admin/wallet_disconnect' }).admin.wallet.status).toBe('connecting')
  })

  test('deployment pins derive seed inputs without exposing editable object ids', () => {
    const loading = reduce_app_state(create_state(), { type: 'admin/deployment_load' })
    const loaded = reduce_app_state(loading, {
      type: 'admin/deployment_loaded',
      network: 'testnet',
      token: 'token',
      revision: 'revision',
      pins: {
        package: '0xpackage',
        math_package: '0xmath',
        upgrade_cap: '0xupgrade',
        math_upgrade_cap: '0xmathupgrade',
        admin_cap: '0xadmin',
        publisher: '0xpublisher',
        version: { id: '0xversion', shared_version: '1' },
        template_registry: { id: '0xtemplates', shared_version: '1' },
        loot_registry: { id: '0xloot', shared_version: '1' },
        worlds: { shore: { id: '0xworld', shared_version: '1' } },
      },
    })

    expect(loaded.admin.config).toEqual({ admin_cap: '0xadmin', worlds: { shore: '0xworld' } })
    expect(loaded.admin.deployment.status).toBe('ready')
  })

  test('publish all is one guarded resumable operation', () => {
    const inspected = {
      ...create_state(),
      admin: {
        ...create_state().admin,
        status: 'ready' as const,
        snapshot: {
          sealed: false,
          batches: [{ id: 'items:0', phase: 'items', state: 'ready' as const, targets: 2, missing_dependencies: [] }],
        },
      },
    }
    expect(reduce_app_state(inspected, { type: 'admin/publish_all' }).admin.operation).toEqual({ type: 'all' })
  })

  test('completed seed inspection exposes an explicit recoverable cleanup operation', () => {
    const loading = reduce_app_state(create_state(), { type: 'admin/refresh' })
    const progressing = reduce_app_state(loading, {
      type: 'admin/progress',
      progress: { phase: 'inspection', current: 4, total: 10, label: 'spells:3' },
    })
    const inspected = reduce_app_state(progressing, {
      type: 'admin/refreshed',
      snapshot: {
        sealed: false,
        batches: [{ id: 'items:0', phase: 'items', state: 'complete', targets: 2, missing_dependencies: [] }],
      },
    })
    const releasing = reduce_app_state(inspected, { type: 'admin/release' })
    const released = reduce_app_state(releasing, { type: 'admin/released' })

    expect(progressing.admin.progress).toMatchObject({ current: 4, total: 10, label: 'spells:3' })
    expect(inspected.admin.cleanup).toBe('needed')
    expect(releasing.admin.operation).toEqual({ type: 'release' })
    expect(released.admin.cleanup).toBe('closed')
  })

  test('deployment progress is retained as a bounded terminal log', () => {
    const logged = Array.from({ length: 105 }, (_, index) => index).reduce(
      (state, index) =>
        reduce_app_state(state, {
          type: 'admin/log',
          tone: index === 104 ? 'success' : 'info',
          message: `step ${index}`,
        }),
      create_state()
    )

    expect(logged.admin.log).toHaveLength(100)
    expect(logged.admin.log[0]?.message).toBe('step 5')
    expect(logged.admin.log.at(-1)).toMatchObject({ id: 105, tone: 'success', message: 'step 104' })
  })

  test('correlated request errors do not become connection errors', () => {
    const state = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/error', id: 7, reason: 'character not found' },
    })
    expect(state.session.link_error).toBeNull()
  })
})
