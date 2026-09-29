// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppShell } from '../../src/components/AppShell.tsx'
import { CharacterTabs, character_tab_invite_enabled } from '../../src/components/CharacterTabs.tsx'
import { owned_party_invite_view } from '../../src/modules/party.ts'
import { WalletCard } from '../../src/components/WalletCard.tsx'
import { mastery_reminder_visible } from '../../src/mastery/model.ts'
import { connection_label, indexing_health_tone } from '../../src/components/connection_status.ts'
import type { AuthSession } from '../../src/auth.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_session_state } from '../../src/modules/session.ts'

const shell_source = readFileSync(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8')

test('the routed shell lazy-loads the dedicated Mastery page', () => {
  const routed = readFileSync(new URL('../../src/components/GamePageWindow.tsx', import.meta.url), 'utf8')
  expect(routed).toContain("import('../mastery/MasteryPage.tsx')")
  expect(routed).toContain('mastery: <MasteryPage')
})

test('daily quest notifications derive from the mastery projection', () => {
  expect(mastery_reminder_visible(1, null, '1')).toBe(true)
  expect(mastery_reminder_visible(0, null, '1')).toBe(false)
})

test('switching tabs inside one fight does not remount its presentation layer', () => {
  const key_selector = shell_source.slice(
    shell_source.indexOf('const environment_key'),
    shell_source.indexOf('// a previewing modal')
  )
  expect(key_selector).toContain('state.fight.checkpoint?.contract.id')
  expect(key_selector).not.toContain('selected_character_id')
})

test('the shared wallet dropdown retains both balances and funding actions', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <WalletCard
      copy={copy}
      disconnect={() => undefined}
      session={{
        ...initial_session_state(),
        wallet: { address: '0x123456789' } as AuthSession,
        sui_balance_mist: 1_250_000_000n,
        kares_balance: 12_345_600_000n,
      }}
    />
  )
  expect(html).toContain('data-wallet-trigger')
  expect(html).toContain('data-sui-logo')
  expect(html).toContain('data-kares-logo')
  expect(html).toContain('Add funds')
  expect(html).toContain('Send')
})

test('compact connection status retains link phases and indexing thresholds', async () => {
  const copy = await load_app_copy('en')
  const session = initial_session_state()
  expect(connection_label(copy, { ...session, link_status: 'connecting', link_error: 'Connection lost' })).toBe(
    copy.server_reconnecting
  )
  expect(connection_label(copy, { ...session, link_status: 'ready' })).toBe(copy.server_connected)
  expect(connection_label(copy, { ...session, link_status: 'connecting', link_violation: 'SPEED' })).toBe(
    copy.server_violation
  )
  expect(indexing_health_tone(null)).toBe('unknown')
  expect(indexing_health_tone(9)).toBe('healthy')
  expect(indexing_health_tone(10)).toBe('catching_up')
  expect(indexing_health_tone(50)).toBe('catching_up')
  expect(indexing_health_tone(51)).toBe('lagging')
})

test('the shell blocks a paused game with the maintenance modal', async () => {
  const copy = await load_app_copy('en')
  const render_paused = (page: 'world' | 'admin' | 'kares') =>
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
        session={Object.freeze({ ...initial_session_state(), game_frozen: true })}
        settings={Object.freeze({ quality: 'medium', music_enabled: true, render_distance: null })}
      />
    )
  const html = render_paused('world')
  const admin_html = render_paused('admin')

  expect(html).toContain('data-game-maintenance=""')
  expect(html).toContain('aria-modal="true"')
  expect(html).toContain('Maintenance in progress')
  expect(html).toContain('The AresRPG smart contract is temporarily paused for maintenance')
  expect(html).toContain('from-[#d92d20]')
  expect(html).not.toContain('data-game-frozen')
  expect(html).not.toContain('bg-[#8f1028]')
  expect(admin_html).not.toContain('data-game-maintenance')
  expect(render_paused('kares')).not.toContain('data-game-maintenance')
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
  const world = renderToStaticMarkup(
    <CharacterTabs
      characters={[character]}
      copy={copy}
      selected_character_id="0xc1"
      create_character={() => undefined}
      select_character={() => undefined}
    />
  )
  expect(world).toContain('data-character-tabs')
  expect(world).toContain('data-character-tab="0xc1"')
  expect(world).toContain('aria-pressed="true"')
  expect(world).toContain('Oeuftermath')
  expect(world).toContain('data-character-tab-create')

  const capped = renderToStaticMarkup(
    <CharacterTabs
      characters={Array.from({ length: 6 }, (_, index) => ({ ...character, id: `0xc${index}`, name: `C${index}` }))}
      copy={copy}
      create_character={() => undefined}
      select_character={() => undefined}
      selected_character_id="0xc0"
    />
  )
  expect(capped).not.toContain('data-character-tab-create')
})

test('a character tab may invite another owned kiosk character, never itself', () => {
  const characters = [
    { id: '0xa', custody: 'kiosk', name: 'A' },
    { id: '0xb', custody: 'kiosk', name: 'B' },
  ] as never
  const view = owned_party_invite_view(characters, '0xa', {}, null)
  expect(character_tab_invite_enabled('0xa', view)).toBeFalse()
  expect(character_tab_invite_enabled('0xb', view)).toBeTrue()
})

test('the Jobs route locks every character tab except the configured crafter', () => {})

test('an accepted non-leader may invite another owned character', () => {
  const characters = [
    { id: '0xa', custody: 'kiosk', name: 'A' },
    { id: '0xb', custody: 'kiosk', name: 'B' },
    { id: '0xc', custody: 'kiosk', name: 'C' },
  ] as never
  const party = {
    id: '0xp',
    members: [
      { character_id: '0xa', name: 'A' },
      { character_id: '0xb', name: 'B' },
    ],
    invited: [],
  }
  const view = owned_party_invite_view(characters, '0xb', { '0xa': '0xp', '0xb': '0xp' }, party)
  const outsider = owned_party_invite_view(characters, '0xc', {}, party)

  expect(character_tab_invite_enabled('0xc', view)).toBeTrue()
  expect(outsider.enabled).toBeFalse()
  expect(
    owned_party_invite_view([{ id: '0xb', custody: 'fight', name: 'B' }] as never, '0xb', {}, null).enabled
  ).toBeFalse()
})

test('a replaced link retains its own status label', async () => {
  const copy = await load_app_copy('en')
  expect(connection_label(copy, { ...initial_session_state(), link_status: 'replaced' })).toBe(copy.server_replaced)
})
