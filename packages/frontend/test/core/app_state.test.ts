// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS, type CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)
const create_state = () => initial_app_state(settings)
const auth_session = (address = '0xowner'): AuthSession =>
  Object.freeze({
    address,
    wallet_name: 'Google',
    identity: 'zklogin',
    sign_personal_message: async () => ({ bytes: '', signature: '' }),
    read_sui_balance: async () => 0n,
    read_kares_balance: async () => 0n,
    gas_spent_24h: () => 0n,
    derive_character_id: () => '0xcharacter',
    is_character_name_claimed: async () => false,
    create_character: async () => ({ digest: '', character_id: '' }),
    // action namespaces are never exercised by these reducer/DOM tests
    fight: {} as never,
    dungeon: {} as never,
    kolizeum: {} as never,
    friends: {} as never,
    party: {} as never,
    mastery: {} as never,
    kares: {} as never,
    character: {} as never,
    read_character_checkpoint: async () => null,
    read_item: async () => ({}) as never,
    marketplace: {} as never,
    stacks: {} as never,
    create_trade: async () => ({ digest: '', trade: {} as never }),
    trade: () => ({}) as never,
    resolve_suins_address: async () => null,
    estimate_sui_transfer: async () => 0n,
    send_sui: async () => ({ digest: 'digest' }),
    read_giftcards: async () => [],
    transfer_giftcards: async () => ({ digest: '', giftcards: [] }),
    claim_giftcard_link: async () => ({
      digest: '',
      giftcard: { id: '0xgift', template: '0xtemplate', amount: 1 },
    }),
    redeem_giftcard: async () => ({ digest: '', item_id: '0xitem', item_version: '10' }),
    create_seed_admin: async () => {
      throw new Error('unused in reducer tests')
    },
    authorize_temp_admin: async () => ({ digest: '' }),
    publish_contract: async () => ({ receipt: {}, objects: [] }),
    upgrade_contract: async () => ({ receipt: {} }),
    read_package_upgrade: async () => ({ package: '', version: 1, policy: 0 }),
    read_game_version: async () => 1,
    read_game_paused: async () => false,
    set_game_paused: async () => ({ digest: '' }),
    read_marketplace_royalties: async () => [],
    claim_marketplace_royalties: async () => ({
      digest: '',
      amount_mist: 0n,
      staking_mist: 0n,
      treasury_mist: 0n,
      policies: [],
    }),
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
  test('game logout preserves the gift intent and independent external connection', () => {
    const ready = reduce_app_state(create_state(), { type: 'distribution/gift_link_ready' })
    const connected = reduce_app_state(ready, {
      type: 'external_wallet/connected',
      sequence: 0,
      session: auth_session(),
    })
    const disconnected = reduce_app_state(connected, { type: 'auth/disconnected' })

    expect(disconnected.distribution).toMatchObject({ gift_link_ready: true, holder_giftcards: null })
    expect(disconnected.external_wallet.session).toBe(connected.external_wallet.session)
  })

  test('holder vouchers and recoverable giftcards remain separate from the game wallet', () => {
    const holder = auth_session('0xholder')
    const card = { id: '0xgift', template: '0xtemplate', amount: 1 }
    const connected = reduce_app_state(create_state(), {
      type: 'external_wallet/connected',
      sequence: 0,
      session: holder,
    })
    const eligible = reduce_app_state(connected, { type: 'distribution/holder_loaded', holder, giftcards: [card] })
    const received = reduce_app_state(eligible, { type: 'giftcard/received', giftcard: card })
    const redeemed = reduce_app_state(received, { type: 'giftcard/redeemed', giftcard: card.id })

    expect(eligible.distribution.holder_giftcards).toEqual([card])
    expect(received.session.giftcards).toEqual([card])
    expect(redeemed.session.giftcards).toEqual([])
  })

  test('the initial mastery snapshot stays in its own address-wide reducer', () => {
    const loaded = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: {
        type: 'packet/mastery',
        mastery: {
          id: '0xm',
          owner: '0xowner',
          points: '4',
          last_completed_epoch: '8',
          quest_epoch: '9',
          quest_started_ms: '100',
          quest_world: 'nauvis',
          quest_dungeon: '0xd',
          quest_reward: 1,
          quest_completed: false,
        },
        offers: [{ id: '0xo', item_type: 'box', template: '0xt', cost: '3', enabled: true }],
      },
    })
    expect(loaded.mastery.row?.points).toBe('4')
    expect(loaded.mastery.offers[0]?.cost).toBe('3')
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
      packet: {
        type: 'packet/server_info',
        online: 42,
        indexing_lag: 7,
        current_epoch: '9',
        chain_timestamp_ms: 1_000_000,
      },
    })
    expect(online.session.online).toBe(42)
    expect(online.session.indexing_lag).toBe(7)
    const frozen = reduce_app_state(online, {
      type: 'server/packet',
      packet: { type: 'packet/game_state', frozen: true },
    })
    expect(frozen.session.game_frozen).toBeTrue()
  })

  test('server latency is session truth and clears before reconnecting', () => {
    const admitted = reduce_app_state(connect(), {
      type: 'server/packet',
      packet: { type: 'packet/connection_accepted', address: '0xowner' },
    })
    const measured = reduce_app_state(admitted, { type: 'link/latency', latency_ms: 42 })
    const indexed = reduce_app_state(measured, {
      type: 'server/packet',
      packet: {
        type: 'packet/server_info',
        online: 42,
        indexing_lag: 12,
        current_epoch: '9',
        chain_timestamp_ms: 1_000_000,
      },
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
  test('all external surfaces share an explicitly selected provider and account', () => {
    const session = auth_session('0xadmin')
    const wallet = {
      name: 'Sui Wallet',
      authorize: async () => ['0xfirst', '0xadmin'],
      connect: async () => session,
      disconnect: async () => undefined,
    }
    const available = reduce_app_state(create_state(), {
      type: 'external_wallet/ready',
      wallets: [wallet],
      remembered: null,
    })
    const authorizing = reduce_app_state(available, { type: 'external_wallet/authorize', wallet_name: wallet.name })
    const choosing = reduce_app_state(authorizing, {
      type: 'external_wallet/accounts',
      sequence: authorizing.external_wallet.sequence,
      accounts: ['0xfirst', '0xadmin'],
    })
    const connecting = reduce_app_state(choosing, { type: 'external_wallet/select', address: '0xadmin' })
    const connected = reduce_app_state(connecting, {
      type: 'external_wallet/connected',
      sequence: connecting.external_wallet.sequence,
      session,
    })
    expect(connected.external_wallet.session).toBe(session)
    expect(connected.session.wallet).toBeNull()
    expect(choosing.external_wallet.accounts).toEqual(['0xfirst', '0xadmin'])
    expect(connecting.external_wallet.request).toMatchObject({ kind: 'connect', address: '0xadmin' })
    expect(reduce_app_state(choosing, { type: 'external_wallet/select', address: '0xother' })).toBe(choosing)
    expect(reduce_app_state(connected, { type: 'external_wallet/disconnect' }).external_wallet.session).toBeNull()
  })

  test('correlated request errors do not become connection errors', () => {
    const state = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/error', id: 7, reason: 'character not found' },
    })
    expect(state.session.link_error).toBeNull()
  })
})

test('a session takeover parks the link red and terminal', () => {
  const state = reduce_app_state(initial_app_state(settings), { type: 'link/replaced' })
  expect(state.session.link_status).toBe('replaced')
})

test('a Mastery snapshot cannot reopen a pending paid redemption', () => {
  const pending = reduce_app_state(create_state(), { type: 'mastery/pending', operation: 'redeem:box' })
  const refreshed = reduce_app_state(pending, {
    type: 'server/packet',
    packet: { type: 'packet/mastery', mastery: null, offers: [] },
  })
  expect(refreshed.mastery.pending).toBe('redeem:box')
  const settled = reduce_app_state(refreshed, { type: 'mastery/reconciled', mastery: null })
  expect(settled.mastery.pending).toBeNull()
})

test('disconnect invalidates an in-flight external giftcard read without blocking the next account', () => {
  const holder = auth_session('0xholder')
  const connected = reduce_app_state(create_state(), {
    type: 'external_wallet/connected',
    sequence: 0,
    session: holder,
  })
  const reading = reduce_app_state(connected, { type: 'distribution/pending', operation: 'load' })
  const disconnected = reduce_app_state(reading, { type: 'external_wallet/disconnect' })
  expect(disconnected.distribution.pending).toBeNull()
  const stale = reduce_app_state(disconnected, {
    type: 'distribution/holder_loaded',
    holder,
    giftcards: [{ id: '0xold', template: '0xtemplate', amount: 1 }],
  })
  expect(stale.distribution.holder_giftcards).toBeNull()
})
