// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character-exact party roster rendering, including multiple characters under one wallet.
import { readFileSync } from 'node:fs'

import { afterAll, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { reset_auth_mock } from '../../../../test_helpers/auth_mock.js'

const party_frame_source = readFileSync(new URL('./PartyFrame.jsx', import.meta.url), 'utf8')

const peer_lookups = []
const party_state = {
  party: {
    id: '0xparty',
    leader_character: '0xleader-character',
    members: [
      { character: '0xleader-character', owner: '0xsame-wallet', order: 0 },
      { character: '0xmember-character', owner: '0xsame-wallet', order: 1 },
    ],
  },
  leave: () => {},
  incoming_dungeon_id: null,
  incoming_template_id: null,
  clear_incoming_dungeon: () => {},
  incoming_invite: null,
  accept_invite: () => {},
  decline_invite: () => {},
  busy: false,
}

reset_auth_mock()
const [react_i18next, game_store, lobby_room, party_store, dungeon_store] = await Promise.all([
  import('react-i18next'),
  import('../../../store.js'),
  import('../../../../p2p/lobby-room.js'),
  import('../../../../world-shell/party_store.js'),
  import('../../../../world-shell/dungeon_store.js'),
])
const spies = [
  spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({ t: (key) => key })),
  spyOn(game_store, 'use_game_state').mockImplementation((selector) =>
    selector({ selected_character_id: null, sui: { characters: [] } })
  ),
  spyOn(lobby_room, 'get_peer_state').mockImplementation((character_id) => {
    peer_lookups.push(character_id)
    return { name: character_id === '0xleader-character' ? 'Exact Leader' : 'Exact Member' }
  }),
  spyOn(party_store, 'use_party').mockImplementation((selector) => selector(party_state)),
  spyOn(dungeon_store, 'use_dungeon').mockImplementation((selector) =>
    selector({ join_shared_dungeon: () => {}, busy: false, dungeon_id: null })
  ),
]

const { PartyFrame } = await import('./PartyFrame.jsx')

afterAll(() => {
  for (const spy of spies) spy.mockRestore()
})

test('same-wallet party members render from their exact member.character identities', () => {
  peer_lookups.length = 0
  const html = renderToStaticMarkup(<PartyFrame />)

  expect(html).toContain('Exact Leader')
  expect(html).toContain('Exact Member')
  expect(peer_lookups).toEqual(['0xleader-character', '0xmember-character'])
  expect(peer_lookups).not.toContain('0xsame-wallet')
})

// #612: the lobby's "Auto follow" text-action read as a toggle but was a one-shot invite; a SEPARATE manual
// toggle also lived on the group roster row. Owner ruling killed the toggle concept everywhere — group
// membership IS auto-follow (kicking is the only disable) — so the picker's invite must be the SAME act as
// the follow-enable, and no toggle control may render anywhere in this file.
test('the picker invite is the ONLY follow-enable act — no toggle exists anywhere in this file', () => {
  expect(party_frame_source).not.toContain('follow_cta')
  expect(party_frame_source).not.toContain('unfollow_cta')
  expect(party_frame_source).not.toContain('enable_group_follow')

  const fn_at = party_frame_source.indexOf(
    'const invite = (character_id) => void invite_owned([character_id])'
  )
  expect(fn_at).toBeGreaterThan(-1)

  const cta_at = party_frame_source.indexOf("t('party.invite_owned_cta')")
  const button_start = party_frame_source.lastIndexOf('<button', cta_at)
  const onclick_at = party_frame_source.indexOf('onClick=', button_start)
  expect(cta_at).toBeGreaterThan(-1)
  expect(onclick_at).toBeGreaterThan(button_start)
  expect(party_frame_source.slice(onclick_at, cta_at)).toContain('invite(')
})
