// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppCopy } from '../../src/i18n/copy.ts'
import type { PlayerMenu } from '../../src/modules/world.ts'

const menu_cell: { menu: PlayerMenu | null } = { menu: null }
const target_cell = { visible: true }
const party_cell: { party: null | Readonly<{ id: string; members: readonly unknown[]; invited: readonly unknown[] }> } =
  {
    party: null,
  }
const target = Object.freeze({ character_id: 'chr-1', name: 'Aiko', owner: '0xaiko' })
mock.module('../../src/store.ts', () => ({
  dispatch_app: () => undefined,
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      world: { player_menu: menu_cell.menu, players: target_cell.visible ? { 'chr-1': target } : {} },
      session: { characters: [{ id: 'own' }], selected_character_id: 'own', wallet: { address: '0xme' } },
      friends: { rows: [] },
      party: {
        by_id: party_cell.party ? { [party_cell.party.id]: party_cell.party } : {},
        party_by_character: party_cell.party ? { own: party_cell.party.id } : {},
        invitation_ids_by_character: {},
        pending_by_character: {},
      },
      trade: { rows: [] },
    }),
}))

const { menu_target, party_invite_visible, PlayerContextMenu } =
  await import('../../src/components/PlayerContextMenu.tsx')

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

const render_for = (source: PlayerMenu['source']): string => {
  menu_cell.menu = Object.freeze({ character_id: 'chr-1', x: 10, y: 20, source })
  return renderToStaticMarkup(<PlayerContextMenu copy={copy} />)
}

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
  target_cell.visible = false
  menu_cell.menu = Object.freeze({
    character_id: 'chr-1',
    name: 'Aiko',
    owner: '0xaiko',
    x: 10,
    y: 20,
    source: 'chat',
  })
  const markup = renderToStaticMarkup(<PlayerContextMenu copy={copy} />)
  for (const label of ['FRIEND', 'GROUP', 'TRADE', 'MESSAGE']) expect(markup).toContain(label)
  target_cell.visible = true
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
  party_cell.party = {
    id: 'party',
    members: [
      { character_id: 'leader', name: 'Leader' },
      { character_id: 'own', name: 'Own' },
    ],
    invited: [],
  }
  const group_button = render_for('chat').match(/<button[^>]*>GROUP<\/button>/)?.[0]
  expect(group_button).toBeDefined()
  expect(group_button).not.toContain('disabled=""')
  party_cell.party = null
})

test('the shared player menu owns the party run action', () => {
  target_cell.visible = false
  expect(render_for('party')).toContain('RUN TO POSITION')
  expect(render_for('party')).not.toContain('MESSAGE')
  target_cell.visible = true
})

test('the one menu host is global instead of disappearing during fights', () => {
  const app = readFileSync(new URL('../../src/app.tsx', import.meta.url), 'utf8')

  expect(app).toContain('<PlayerContextMenu copy={copy} />')
  expect(app).not.toContain('PlayerContextLayer')
})
