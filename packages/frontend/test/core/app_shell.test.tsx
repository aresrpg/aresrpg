// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppShell } from '../../src/components/AppShell.tsx'
import { Sidebar } from '../../src/components/Sidebar.tsx'
import { ConnectionCard, indexing_health_tone } from '../../src/components/SidebarCards.tsx'
import type { AuthSession } from '../../src/auth.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_session_state } from '../../src/modules/session.ts'

test('the account card sits below navigation and above language with row actions', async () => {
  const copy = await load_app_copy('en')
  const wallet = Object.freeze({
    address: '0x123456789',
    wallet_name: 'Google',
    sign_personal_message: async () => ({ bytes: '', signature: '' }),
    read_sui_balance: async () => 0n,
    gas_spent_24h: () => 0n,
    derive_character_id: () => '',
    is_character_name_claimed: async () => false,
    create_character: async () => ({ digest: '', character_id: '' }),
    resolve_suins_address: async () => null,
    estimate_sui_transfer: async () => 0n,
    send_sui: async () => ({ digest: null }),
    buy_shop_item: async () => ({ digest: '' }),
    claim_airdrop: async () => ({ digest: '' }),
    create_seed_admin: async () => {
      throw new Error('not used while rendering')
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
  }) satisfies AuthSession
  const html = renderToStaticMarkup(
    <AppShell
      change_locale={() => undefined}
      copy={copy}
      disconnect={() => undefined}
      locale="en"
      network="testnet"
      open_page={() => undefined}
      open_path={() => undefined}
      page="world"
      pathname="/"
      create_character={() => undefined}
      select_character={() => undefined}
      session={Object.freeze({
        ...initial_session_state(),
        link_status: 'connecting',
        wallet,
        sui_balance_mist: 1_250_000_000n,
        gas_spent_mist: 20_000_000n,
      })}
      settings={Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })}
    />
  )

  expect(html.indexOf('data-app-sidebar')).toBeLessThan(html.indexOf('data-wallet-card'))
  expect(html.indexOf('data-wallet-card')).toBeLessThan(html.indexOf('data-language-card'))
  expect(html.indexOf('data-language-card')).toBeLessThan(html.indexOf('data-discord-card'))
  expect(html.indexOf('data-discord-card')).toBeLessThan(html.indexOf('data-connection-card'))
  expect(html).toContain('data-wallet-actions=""')
  expect(html).toContain('Sui Universe')
  expect(html).toContain('Connecting')
  expect(html).toContain('TESTNET')
  expect(html).toContain('class="flex flex-col gap-1"')
  expect(html).not.toContain('data-page="simulator"')
  for (const page of ['shop', 'airdrop', 'settings']) {
    const button = html.match(new RegExp(`<button[^>]*data-page="${page}"[^>]*>`))?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain('disabled')
  }

  // The network badge is testnet-only.
  const sidebar = (network: 'mainnet' | 'testnet') =>
    renderToStaticMarkup(
      <Sidebar address={null} copy={copy} network={network} open_page={() => undefined} page="world" />
    )
  expect(sidebar('testnet')).toContain('TESTNET')
  expect(sidebar('mainnet')).not.toContain('TESTNET')
})

test('the sidebar connection card renders reducer-owned link phases', async () => {
  const copy = await load_app_copy('en')
  const reconnecting = renderToStaticMarkup(
    <ConnectionCard
      copy={copy}
      error="Connection lost"
      indexing_lag={null}
      latency_ms={null}
      online={null}
      status="connecting"
    />
  )
  const connected = renderToStaticMarkup(
    <ConnectionCard copy={copy} error={null} indexing_lag={9} latency_ms={42} online={3} status="ready" />
  )

  expect(reconnecting).toContain('Reconnecting')
  expect(reconnecting).toContain('title="Connection lost"')
  expect(connected).toContain('Connected')
  expect(connected).toContain('42 ms')
  expect(connected).toContain('bg-[#5ee38d]')
  expect(connected).toContain('data-indexing-health="healthy"')
  expect(connected).not.toContain('Actions in the game can lag behind')

  // A violation drop turns the card red and says so, whatever the retry phase reads.
  const violated = renderToStaticMarkup(
    <ConnectionCard
      copy={copy}
      error="SPEED"
      indexing_lag={null}
      latency_ms={null}
      online={null}
      status="connecting"
      violation="SPEED"
    />
  )
  expect(violated).toContain('rule violation')
  expect(violated).toContain('data-connection-violation="SPEED"')
  expect(violated).toContain('border-[#ff5a8b]/25')

  // Indexing health uses the exact catch-up thresholds.
  const render = (indexing_lag: number) =>
    renderToStaticMarkup(
      <ConnectionCard copy={copy} error={null} indexing_lag={indexing_lag} latency_ms={42} online={3} status="ready" />
    )

  expect(indexing_health_tone(null)).toBe('unknown')
  expect(indexing_health_tone(9)).toBe('healthy')
  expect(indexing_health_tone(10)).toBe('catching_up')
  expect(indexing_health_tone(50)).toBe('catching_up')
  expect(indexing_health_tone(51)).toBe('lagging')
  expect(render(10)).toContain('data-indexing-health="catching_up"')
  expect(render(10)).not.toContain('Actions in the game can lag behind')
  expect(render(51)).toContain('data-indexing-health="lagging"')
  expect(render(51)).toContain('Actions in the game can lag behind')
})

test('the shell makes a frozen game impossible to miss', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <AppShell
      change_locale={() => undefined}
      copy={copy}
      disconnect={() => undefined}
      locale="en"
      network="testnet"
      open_page={() => undefined}
      open_path={() => undefined}
      page="world"
      pathname="/"
      create_character={() => undefined}
      select_character={() => undefined}
      session={Object.freeze({ ...initial_session_state(), game_frozen: true })}
      settings={Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })}
    />
  )

  expect(html).toContain('data-game-frozen="true"')
  expect(html).toContain('The game is currently frozen')
  expect(html).toContain('bg-[#8f1028]')
})

test('the character tab strip lives on character-scoped pages and selects through its tabs', async () => {
  const copy = await load_app_copy('en')
  const character = {
    id: '0xc1',
    name: 'Oeuftermath',
    classe: 'senshi',
    sex: 'male',
    experience: '0',
    level: 7,
    color_1: 0,
    color_2: 0,
    color_3: 0,
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
    kiosk: '0xk1',
    equipment: [],
  }
  const shell = (page: 'world' | 'shop') =>
    renderToStaticMarkup(
      <AppShell
        change_locale={() => undefined}
        copy={copy}
        disconnect={() => undefined}
        locale="en"
        network="testnet"
        open_page={() => undefined}
        open_path={() => undefined}
        page={page}
        pathname="/"
        create_character={() => undefined}
        select_character={() => undefined}
        session={Object.freeze({
          ...initial_session_state(),
          characters: [character],
          selected_character_id: '0xc1',
        })}
        settings={Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })}
      />
    )

  const world = shell('world')
  expect(world).toContain('data-character-tabs')
  expect(world).toContain('data-character-tab="0xc1"')
  expect(world).toContain('aria-pressed="true"')
  expect(world).toContain('Oeuftermath')
  expect(world).toContain('data-character-tab-create')
  expect(shell('shop')).not.toContain('data-character-tabs')
})
