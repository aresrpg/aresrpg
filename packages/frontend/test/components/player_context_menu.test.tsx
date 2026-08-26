// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AppCopy } from '../../src/i18n/copy.ts'
import type { PlayerMenu } from '../../src/modules/world.ts'

const menu_cell: { menu: PlayerMenu | null } = { menu: null }
const target = Object.freeze({ character_id: 'chr-1', name: 'Aiko', owner: '0xaiko' })
mock.module('../../src/store.ts', () => ({
  dispatch_app: () => undefined,
  useAppStore: (select: (state: unknown) => unknown) =>
    select({
      world: { player_menu: menu_cell.menu, players: { 'chr-1': target } },
      session: { characters: [{ id: 'own' }], selected_character_id: 'own', wallet: { address: '0xme' } },
      friends: { rows: [] },
      party: { by_id: {}, party_by_character: {}, invitation_ids_by_character: {}, pending_by_character: {} },
      trade: { rows: [] },
    }),
}))

const { PlayerContextMenu } = await import('../../src/components/PlayerContextMenu.tsx')

const copy = {
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
