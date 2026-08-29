// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { world_center } from '@aresrpg/immutable'

import { party_frame_visible, party_run_available, party_run_distance } from '../../src/components/PartyFrame.tsx'
import en from '../../src/i18n/locales/en.yaml'

const friends_source = readFileSync(new URL('../../src/components/FriendsPanel.tsx', import.meta.url), 'utf8')
const shell_source = readFileSync(new URL('../../src/components/AppShell.tsx', import.meta.url), 'utf8')
const party_source = readFileSync(new URL('../../src/components/PartyFrame.tsx', import.meta.url), 'utf8')
const party_css = readFileSync(new URL('../../src/components/party_frame.css', import.meta.url), 'utf8')
const minimap_css = readFileSync(new URL('../../src/game/hud/minimap.css', import.meta.url), 'utf8')
const trade_css = readFileSync(new URL('../../src/components/trade_inbox.css', import.meta.url), 'utf8')

test('owned character candidates do not impersonate a created party', () => {
  expect(party_frame_visible(null, null)).toBeFalse()
  expect(party_frame_visible({ id: '0xp' } as never, null)).toBeTrue()
  expect(party_frame_visible({ id: '0xp' } as never, 'leave')).toBeFalse()
  expect(party_source).not.toContain("text('invite_owned')")
})

test('party invitations live below friends and name the group invitation', () => {
  expect(friends_source).toContain('<PartyInviteCard')
  expect(shell_source).not.toContain('<PartyInviteCard')
  expect(en.party_panel.invited_by).toBe('{{name}} invited you to join his group')
})

test('the leader controls one follow mode and follower rows expose distance progress', () => {
  expect(en.party_panel.follow_leader).toBe('Follow leader')
  expect(party_source).toContain('follow_leader: event.target.checked')
  expect(party_source).toContain('<Footprints')
  expect(party_source).toContain('PartyDistanceProgress')
  expect(party_css).toContain('width: max-content')
  expect(party_css).toContain('top: 340px')
  expect(party_css).toContain('right: 16px')
  expect(party_css).not.toContain('left: 16px')
  expect(party_css).toContain('max-height: 220px')
  expect(party_css).toContain('main:has(.party-frame) .trade-hud')
  expect(party_css).toContain('top: max(574px, calc(var(--safe-top) + 1rem))')
  expect(minimap_css).toContain('right: 14px')
  expect(minimap_css).toContain('width: 288px')
  expect(trade_css).toContain('right: max(26px, var(--safe-right))')
  expect(party_css).toContain('grid-template-columns: 14px minmax(72px, 1fr) max-content')
  expect(party_css).toContain('width: 100%')
})

test('the active external run target reuses distance progress in green', () => {
  const run = {
    status: 'running',
    source: 'character',
    controlled_character_id: '0xa',
    target_character_id: '0xc',
    name: 'Cyr',
    world: 'nauvis',
    x: world_center + 12,
    z: world_center + 5,
  } as const
  const pose = { character_id: '0xa', x: 0, y: 0, z: 0 } as never
  expect(party_run_distance(run, pose, '0xc')).toBe(13)
  expect(party_run_distance(run, pose, '0xb')).toBeNull()
  expect(party_css).toContain('.party-distance-progress.is-running em')
  expect(party_css).toContain('background: #4fd6a0')
})

test('member removal occupies the trailing control cell', () => {
  const control = party_source.slice(
    party_source.indexOf('const PartyMemberControl'),
    party_source.indexOf('const PartyMemberRow')
  )
  expect(control).toContain("type: 'party/kick'")
})

test('only external party members open the shared player menu for run-to', () => {
  const owned = [{ id: '0xa' }, { id: '0xb' }]
  expect(party_run_available(owned, '0xa')).toBeFalse()
  expect(party_run_available(owned, '0xc')).toBeTrue()
  expect(en.party_panel.run_to_position).toBe('Run to position')
  expect(party_source).toContain("source: 'party'")
  expect(party_css).toContain('.party-frame__member.can-run')
  expect(party_css).toContain('cursor: pointer')
})
