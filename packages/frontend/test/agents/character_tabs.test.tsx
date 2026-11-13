// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { dispatch_app, initialize_app_store, read_app_state } from '../../src/store.ts'
import { watch_agent_character } from '../../src/agents/watch_character.ts'
import { displayed_character } from '../../src/agents/observation.ts'
import { read_character_recall } from '../../src/agents/character_recall.ts'
import { selected_character } from '../../src/modules/session.ts'
import { CharacterTabs, CharacterTabMenu } from '../../src/components/CharacterTabs.tsx'
import { agent_tab_source } from '../../src/agents/character_tabs.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import type { AuthSession } from '../../src/auth.ts'
import { automation_fixture, character } from '../modules/automation_fixture.ts'

const copy = {
  characters: 'Characters',
  create_character: 'Create',
  ui: { agent_watch: 'Watch agent', agent_recall: 'Recall' },
  settings_page: {},
} as unknown as AppCopy
const wallet = {
  address: 'owner',
  read_agent_pairing_request: () => ({ zklogin_public_identifier: 'google' }),
} as unknown as AuthSession
const pairing = { address: 'agent', multisig_public_key: 'descriptor', signer_mode: 'host-persistent' as const }
const row = { ...character(), id: 'transferred', name: 'Transferred hero', equipment: [] }
const reset = () => initialize_app_store(automation_fixture().settings)
afterEach(reset)
const transferred = () => {
  reset()
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session: wallet })
  dispatch_app({ type: 'agent/inventory_target', wallet, pairing })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [row] } })
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory_observed',
      id: read_app_state().session.agent_inventory.serial,
      packet: { type: 'packet/characters', characters: [{ ...row, kiosk: 'agent-kiosk' }] },
    },
  })
}

test('a transferred character stays in live tabs with the approved circuit and robot, without becoming owned', () => {
  transferred()
  const { session } = read_app_state()
  const html = renderToStaticMarkup(
    <CharacterTabs
      characters={session.characters}
      agent_characters={agent_tab_source(session).characters}
      selected_character_id={session.selected_character_id}
      select_character={() => {}}
      copy={copy}
      create_character={() => {}}
    />
  )
  expect(html).toContain('data-character-tab="transferred"')
  expect(html).toContain('data-delegated="agent"')
  expect(html).toContain('character-tab-bot')
  expect(read_app_state().session.characters).toEqual([])
  expect(selected_character(read_app_state().session)).toBeNull()
})
test('an agent-only roster does not leave the player trapped behind the empty-owned-roster welcome', () => {
  transferred()
  expect(read_app_state().navigation.dialog).toBeNull()
})

test('agent tab selection enters existing read-only observation and an owned tab restores control after Recall', () => {
  transferred()
  watch_agent_character('unknown', copy)
  expect(read_app_state().session.agent_view.request).toBeNull()
  watch_agent_character(row.id, copy)
  const watching = read_app_state().session
  expect(watching.agent_view.request).toMatchObject({ pairing, character_id: row.id, public_identifier: 'google' })
  expect(selected_character(watching)).toBeNull()
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/agent_observed',
      id: watching.agent_view.serial,
      characters: [row],
      selected_character_id: row.id,
      failed: false,
    },
  })
  expect(displayed_character(read_app_state().session)?.id).toBe(row.id)
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [row] } })
  expect(agent_tab_source(read_app_state().session).characters).toEqual([])
  expect(selected_character(read_app_state().session)).toBeNull()
  dispatch_app({ type: 'character/select', character_id: row.id })
  expect(read_app_state().session.agent_view.request).toBeNull()
  expect(selected_character(read_app_state().session)?.id).toBe(row.id)
})

test('wallet replacement retires agent tabs and stale roster packets cannot restore them', () => {
  transferred()
  const { serial } = read_app_state().session.agent_inventory
  dispatch_app({ type: 'auth/disconnected' })
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/inventory_observed', id: serial, packet: { type: 'packet/characters', characters: [row] } },
  })
  expect(agent_tab_source(read_app_state().session).characters).toEqual([])
})

test('Recall resumes a verified pending character and gear claim rather than offering the unequipped character again', async () => {
  const offer = {
    character_id: row.id,
    seller_kiosk: 'agent-kiosk',
    purchase_cap: 'cap',
    recipient: wallet.address,
    agent_address: pairing.address,
    equipment: [{ slot: 'tool', item_id: 'tool', purchase_cap: 'tool-cap' }],
  }
  const claim = { sender: wallet.address } as AuthSession['agent_transfer']
  const recall = { transfer: { sender: pairing.address }, read_incoming_items: async () => [] }
  const session = {
    ...wallet,
    agent_transfer: claim,
    read_agent_recall: async () => recall,
    read_agent_returns: async () => [offer],
  } as unknown as AuthSession
  const plan = await read_character_recall(session, pairing, { ...row, equipment: [] })
  expect(plan.actions).toBe(claim)
  expect(plan.intent).toEqual({ kind: 'claim', ...offer })
  expect(plan.handover).toBeUndefined()
  const fresh = await read_character_recall({ ...session, read_agent_returns: async () => [] }, pairing, {
    ...row,
    equipment: [{ id: 'equipped-tool', slot: 'tool' }] as typeof row.equipment,
  })
  expect(fresh.intent).toMatchObject({
    kind: 'offer',
    character_id: row.id,
    recipient: wallet.address,
    unequip: [{ item_id: 'equipped-tool', slot: 'tool' }],
  })
  expect(fresh.handover?.claim).toBe(claim)
})

test('spectator-owned menus retain read-only actions without mounting player write actions', () => {
  const menu_copy = {
    ...copy,
    ui: { ...copy.ui, view_on_suivision: 'View on SuiVision', portrait_share: 'Share portrait' },
  }
  const id = `0x${'ab'.repeat(32)}`
  const render_menu = (read_only: boolean) =>
    renderToStaticMarkup(
      <CharacterTabMenu character_id={id} copy={menu_copy} can_manage={!read_only} portrait={() => {}} close={() => {}}>
        <button>Send or setup agent</button>
        <button>Invite</button>
        <button>Delete</button>
      </CharacterTabMenu>
    )
  const spectator = render_menu(true)
  expect(spectator).toContain(`/object/${id}`)
  expect(spectator).toContain('View on SuiVision')
  expect(spectator).toContain('Share portrait')
  for (const label of ['Send or setup agent', 'Invite', 'Delete']) {
    expect(spectator).not.toContain(label)
    expect(render_menu(false)).toContain(label)
  }
})
