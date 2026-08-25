// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADMIN_ADDRESS, type CharacterRow } from '@aresrpg/protocol'

import type { AuthSession } from '../../src/auth.ts'
import {
  PACKAGE_PROPAGATION_MS,
  can_reuse_core_artifact,
  dependency_artifact_changed,
  deployment_compile_target,
  republish_needs_seed_cleanup,
  wait_for_package_propagation,
} from '../../src/admin/admin_deployment.ts'
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
    sign_personal_message: async () => ({ bytes: '', signature: '' }),
    read_sui_balance: async () => 0n,
    gas_spent_24h: () => 0n,
    derive_character_id: () => '0xcharacter',
    is_character_name_claimed: async () => false,
    create_character: async () => ({ digest: '', character_id: '' }),
    // action namespaces are never exercised by these reducer/DOM tests
    fight: {} as never,
    dungeon: {} as never,
    character: {} as never,
    marketplace: {} as never,
    stacks: {} as never,
    create_trade: async () => ({ digest: '', trade: {} as never }),
    trade: () => ({}) as never,
    resolve_suins_address: async () => null,
    estimate_sui_transfer: async () => 0n,
    send_sui: async () => ({ digest: null }),
    buy_shop_item: async () => ({ digest: '', items: [] }),
    claim_airdrop: async () => ({ digest: '' }),
    create_seed_admin: async () => {
      throw new Error('unused in reducer tests')
    },
    publish_contract: async () => ({ receipt: {}, objects: [] }),
    upgrade_contract: async () => ({ receipt: {} }),
    read_package_upgrade: async () => ({ package: '', version: 1, policy: 0 }),
    read_game_version: async () => 1,
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
  test('republish skips seed-session cleanup until a Registry and central authority exist', () => {
    expect(republish_needs_seed_cleanup(null)).toBeFalse()
    expect(
      republish_needs_seed_cleanup({
        control_package: '0xcontrol',
        admin_cap: '0xadmin',
        seed_package: '0xseed',
        content_root: { id: null, shared_version: null },
      } as never)
    ).toBeFalse()
    expect(
      republish_needs_seed_cleanup({
        control_package: '0xcontrol',
        admin_cap: '0xadmin',
        seed_package: '0xseed',
        content_root: { id: '0xroot', shared_version: '1' },
      } as never)
    ).toBeTrue()
  })

  test('a selective republish compiles math before any consumer of its published ABI', () => {
    expect(deployment_compile_target(null)).toBe('math')
    expect(
      deployment_compile_target({
        math_package: '0xmath',
        math_upgrade_cap: '0xmathcap',
        control_package: '0xcontrol',
        control_upgrade_cap: '0xcontrolcap',
        seed_package: '0xseed',
        seed_upgrade_cap: '0xseedcap',
      } as never)
    ).toBe('math')
  })

  test('a retained dependency without the matching artifact fingerprint must republish', () => {
    const artifact = { package_name: 'aresrpg_math', digest: [0x01, 0xab], modules: [], dependencies: [] } as const
    expect(dependency_artifact_changed(null, artifact)).toBeTrue()
    expect(dependency_artifact_changed('deadbeef', artifact)).toBeTrue()
    expect(dependency_artifact_changed('01ab', artifact)).toBeFalse()
  })

  test('a dependency republication invalidates a previously compiled core artifact', () => {
    const artifact = { package_name: 'aresrpg', digest: [], modules: [], dependencies: [] } as const
    expect(can_reuse_core_artifact(artifact, false)).toBeTrue()
    expect(can_reuse_core_artifact(artifact, true)).toBeFalse()
  })

  test('receipt-derived shop facts survive routed page changes without a transaction reducer', () => {
    const loaded = reduce_app_state(connect(), {
      type: 'server/packet',
      packet: {
        type: 'packet/shop_state',
        sales: [{ item_type: 'pet_lootbox', price: '1000000000', supply: '8', infinite: false, enabled: true }],
        airdrops: [{ drop_id: 'founders', eligible: true, eligible_count: 2 }],
      },
    })
    const bought = reduce_app_state(loaded, { type: 'shop/purchased', item_type: 'pet_lootbox', quantity: 2 })
    const claimed = reduce_app_state(bought, { type: 'airdrop/claimed', drop_id: 'founders' })
    expect(claimed.session.shop).toEqual({
      sales: [{ item_type: 'pet_lootbox', price: '1000000000', supply: '6', infinite: false, enabled: true }],
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

  test('admin opens only for the publisher wallet, behind an explicit separate signer', () => {
    // only the publisher wallet can open admin and only the next inspected batch can execute
    {
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
          snapshot: { batches: [] },
        })
      ).toBe(executing)
    }

    // the separate admin signer requires an explicit provider and account choice
    {
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
    }
  })

  test('deployment pins, contract maintenance, and every guarded operation hold their states', () => {
    // deployment pins derive seed inputs without exposing editable object ids
    {
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
          publisher: '0xpublisher',
          version: { id: '0xversion', shared_version: '1' },
          loot_registry: { id: '0xloot', shared_version: '1' },
        },
      })

      expect(loaded.admin.config).toEqual({
        admin_cap: '',
        content_root: '',
        upgrade_caps: [
          { cap: '0xmathupgrade', package: '0xmath' },
          { cap: '0xupgrade', package: '0xpackage' },
        ],
      })
      expect(loaded.admin.deployment.status).toBe('ready')
    }

    // contract maintenance has guarded upgrade and two-step republish states
    {
      const base = create_state()
      const ready = {
        ...base,
        admin: {
          ...base.admin,
          snapshot: { batches: [], sealed: true },
          cleanup: 'closed' as const,
          deployment: {
            ...base.admin.deployment,
            status: 'ready' as const,
            network: 'testnet' as const,
            revision: 'one',
            paused: false,
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
              item_policy: { id: '0xitempolicy', shared_version: '1' },
              character_policy: { id: '0xcharacterpolicy', shared_version: '1' },
              item_protected_policy: { id: '0xitemprotected', shared_version: '1' },
              character_protected_policy: { id: '0xcharacterprotected', shared_version: '1' },
            },
          },
        },
      }
      expect(reduce_app_state(ready, { type: 'admin/contracts_upgrade' }).admin.deployment.status).toBe('upgrading')

      const armed = reduce_app_state(ready, { type: 'admin/republish_armed', armed: true })
      const resetting = reduce_app_state(armed, { type: 'admin/contracts_republish' })
      const republished = reduce_app_state(resetting, {
        type: 'admin/contracts_republished',
        revision: 'two',
        pins: { ...ready.admin.deployment.pins!, package: null },
      })
      expect(resetting.admin.deployment.status).toBe('resetting')
      expect(republished.admin.snapshot).toBeNull()
      expect(republished.admin.cleanup).toBe('unknown')
      expect(republished.admin.deployment.pins?.package).toBeNull()
    }

    // publish all is one guarded resumable operation
    {
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
    }

    // completed seed inspection exposes an explicit recoverable cleanup operation
    {
      const loading = reduce_app_state(create_state(), { type: 'admin/refresh' })
      const progressing = reduce_app_state(loading, {
        type: 'admin/progress',
        progress: { phase: 'inspection', current: 4, total: 10, label: 'spells:3' },
      })
      const inspected = reduce_app_state(progressing, {
        type: 'admin/refreshed',
        snapshot: {
          batches: [{ id: 'items:0', phase: 'items', state: 'complete', targets: 2, missing_dependencies: [] }],
        },
      })
      const releasing = reduce_app_state(inspected, { type: 'admin/release' })
      const released = reduce_app_state(releasing, { type: 'admin/released' })

      expect(progressing.admin.progress).toMatchObject({ current: 4, total: 10, label: 'spells:3' })
      expect(inspected.admin.cleanup).toBe('needed')
      expect(releasing.admin.operation).toEqual({ type: 'release' })
      expect(released.admin.cleanup).toBe('closed')
    }

    // deployment progress is retained as a bounded terminal log
    {
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
    }
  })

  test('correlated request errors do not become connection errors', () => {
    const state = reduce_app_state(create_state(), {
      type: 'server/packet',
      packet: { type: 'packet/error', id: 7, reason: 'character not found' },
    })
    expect(state.session.link_error).toBeNull()
  })

  test('package upgrades wait before the next RPC node must resolve the new package', async () => {
    const waits: number[] = []
    await wait_for_package_propagation(async (milliseconds) => void waits.push(milliseconds))
    expect(waits).toEqual([PACKAGE_PROPAGATION_MS])
  })
})

test('a session takeover parks the link red and terminal', () => {
  const state = reduce_app_state(initial_app_state(settings), { type: 'link/replaced' })
  expect(state.session.link_status).toBe('replaced')
})
