// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

const source = (path: string): string => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')

test('every direct React transaction owner has a synchronous pre-render lock', () => {
  const shared_guard = [
    'airdrop/AirdropPage.tsx',
    'shop/ShopPage.tsx',
    'characters/EquipmentTab.tsx',
    'characters/InventoryOverlays.tsx',
    'characters/JobsTab.tsx',
    'characters/RuneforgeTab.tsx',
    'characters/SpellsTab.tsx',
    'characters/StatsTab.tsx',
    'components/CharacterCreateModal.tsx',
    'components/FightPrompt.tsx',
    'components/TravelModal.tsx',
  ]
  shared_guard.forEach((path) => expect(source(path)).toContain('run_direct_transaction'))

  expect(source('characters/BoxReveal.tsx')).toContain('runtime.opened')
  expect(source('components/SendSuiModal.tsx')).toContain('executing.current')
  expect(source('admin/AdminWalletPanel.tsx')).toContain('claiming_now.current')
})

test('character creation reports a rejected transaction only at its app owner', () => {
  const modal = source('components/CharacterCreateModal.tsx')
  expect(modal).not.toContain("from '../toast.ts'")
  expect(modal).not.toContain('toast.add')
})

test('every reducer-owned transaction domain keeps an effect-boundary lock', () => {
  const guards: Readonly<Record<string, string>> = {
    'modules/world.ts': 'const in_flight = new Set<string>()',
    'modules/world_gather.ts': 'in_flight.has(',
    'modules/friends.ts': 'get_state().friends.pending',
    'modules/party.ts': 'pending_by_character[character_id]',
    'modules/trade.ts': 'const running = new Map<string, symbol>()',
    'modules/marketplace.ts': 'const in_flight = new Set<string>()',
    'modules/duel.ts': 'const challenging = new Set<string>()',
    'modules/dungeon.ts': 'pending_by_character[character_id]',
    'modules/kolizeum.ts': 'pending_by_character[character_id]',
    'modules/party_follow.ts': 'const joining_fights = new Set<string>()',
    'modules/fight_chain.ts': 'const in_flight = new Set<string>()',
    'modules/fight_result_observer.ts': 'const closing = new Set<string>()',
    'modules/claims.ts': 'let active_claim_id: string | null = null',
    'modules/admin.ts': "state.admin.status !== 'executing'",
    'admin/admin_deployment.ts': "previous_deployment.status !== 'publishing'",
  }
  Object.entries(guards).forEach(([path, guard]) => expect(source(path)).toContain(guard))
})
