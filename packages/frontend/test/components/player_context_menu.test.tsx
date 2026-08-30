// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppCopy } from '../../src/i18n/copy.ts'
import {
  menu_target,
  party_invite_visible,
  PlayerSocialRows,
  RunToRow,
} from '../../src/components/PlayerContextMenu.tsx'

const copy = {
  party_panel: { run_to_position: 'RUN TO POSITION' },
  world_hud: {
    menu_friend: 'FRIEND',
    menu_group: 'GROUP',
    menu_trade: 'TRADE',
    menu_duel: 'DUEL',
    menu_message: 'MESSAGE',
  },
} as unknown as AppCopy

const noop = (): void => undefined
const render_for = (source: 'body' | 'chat' | 'party', can_invite = true): string =>
  renderToStaticMarkup(
    <PlayerSocialRows
      add_friend={noop}
      already_friend={false}
      can_invite={can_invite}
      copy={copy}
      duel={noop}
      invite={noop}
      invite_visible
      message={noop}
      source={source}
      trade={noop}
      trade_disabled={false}
      visible
    />
  )

// A duel needs the two characters standing together — the chain proves the walk to the fight
// cell — so a name clicked in the chat log, which says nothing about distance, is not a
// challenge door (owner 2026-08-21).
test('only the menu opened on a body offers the duel', () => {
  expect(render_for('body')).toContain('DUEL')
  expect(render_for('chat')).not.toContain('DUEL')
})

test('every other social door stays on both menus', () => {
  for (const markup of [render_for('body'), render_for('chat')])
    for (const label of ['FRIEND', 'GROUP', 'TRADE', 'MESSAGE']) expect(markup).toContain(label)
})

test('chat uses the wire identity even when the speaker is absent from world presence', () => {
  const menu = Object.freeze({
    character_id: 'chr-1',
    name: 'Aiko',
    owner: '0xaiko',
    x: 10,
    y: 20,
    source: 'chat',
  })
  expect(menu_target(menu, {})).toBe(menu)
  const markup = render_for('chat')
  for (const label of ['FRIEND', 'GROUP', 'TRADE', 'MESSAGE']) expect(markup).toContain(label)
})

test('the chat fallback returns its stored snapshot without allocating', () => {
  const menu = Object.freeze({ character_id: 'chr-1', name: 'Aiko', owner: '0xaiko' })
  expect(menu_target(menu, {})).toBe(menu)
})

test('a current or invited party member is not offered another invitation', () => {
  const party = {
    id: '0xparty',
    members: [{ character_id: '0xmember', name: 'Member' }],
    invited: [{ character_id: '0xinvited', name: 'Invited' }],
  }
  expect(party_invite_visible(party, { character_id: '0xmember' })).toBeFalse()
  expect(party_invite_visible(party, { character_id: '0xinvited' })).toBeFalse()
  expect(party_invite_visible(party, { character_id: '0xnew' })).toBeTrue()
})

test('an accepted non-leader can invite from the shared menu', () => {
  const party = {
    id: 'party',
    members: [
      { character_id: 'leader', name: 'Leader' },
      { character_id: 'own', name: 'Own' },
    ],
    invited: [],
  }
  expect(party_invite_visible(party, { character_id: 'target' })).toBeTrue()
  const group_button = render_for('chat', true).match(/<button[^>]*>GROUP<\/button>/)?.[0]
  expect(group_button).toBeDefined()
  expect(group_button).not.toContain('disabled=""')
})

test('the shared player menu owns the party run action', () => {
  const markup = renderToStaticMarkup(<RunToRow label="RUN TO POSITION" run={noop} visible />)
  expect(markup).toContain('RUN TO POSITION')
  expect(markup).not.toContain('MESSAGE')
})

test('the one menu host is global instead of disappearing during fights', () => {
  const app = readFileSync(new URL('../../src/app.tsx', import.meta.url), 'utf8')

  expect(app).toContain('<PlayerContextMenu copy={copy} />')
  expect(app).not.toContain('PlayerContextLayer')
})
