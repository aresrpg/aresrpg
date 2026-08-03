// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1661 — THE GHOST PARTY MEMBER. A DEFEAT card listed the player's second character in YOUR PARTY for a fight
// that character never joined. The chain was never the liar: `engine/sources/fight.move:283` seats exactly ONE
// participant at create (the creator) and every further seat comes through an explicit per-character `join` tx
// (`aresrpg/sources/fight.move:185`), with `party_id` acting only as a JOIN ACL (`engine/fight.move:546`) —
// party membership enrolls nobody. The lie was the client's: both end-fight cards derived "me" from the LIVE
// `selected_character_id`, then synthesized a party row for it whenever the recap roster held no matching seat.
// Switch characters after a fight (or let the switcher move under the persistent `fight_summary` slice) and the
// card invents the newly-selected character as a fallen party member of a fight it never entered.
//
// The fix makes presence sourced, not inferred: the recap captures the seat identity while the fight slice is
// still live (`summary.me_id`), and the shared projection only ever claims presence it can source.
import { expect, test } from 'bun:test'

import { fight_report_party_rows } from '../../../../src/game/screens/hud/fight_report_roster.js'
import { fight_recap_payload } from '../../../../src/world-shell/fight_recap.js'

const ARES = '0xares' // the character that actually fought
const SHOGO = '0xshogo' // the same wallet's OTHER character — the ghost the card used to render
const MY_ADDR = '0xowner' // both characters live in the same wallet, so `owner` cannot tell them apart

const defeat_args = {
  me_name: 'ARES',
  my_level: 12,
  my_class: 'Senshi',
  self_alive: false,
  fallback_name: 'You',
}

/** the fighters map engine_view builds off the chain fight's escrow — one seat, mine, fallen. */
const one_seat_roster = () =>
  new Map([[ARES, { id: ARES, name: 'ARES', team: 0, level: 12, is_player: true, dead: true, owner: MY_ADDR }]])

test('#1661 the recap carries the SEAT identity, so presence survives a character switch', () => {
  const { summary } = fight_recap_payload({
    fighters: one_seat_roster(),
    my_addr: MY_ADDR,
    my_entity_id: ARES, // engine_view.my_entity_id — captured while the fight slice was still live
    winner: 1,
  })

  expect(summary.me_id).toBe(ARES)
  expect(summary.participants.map((p) => p.id)).toEqual([ARES])
})

test('#1661 a recap with no captured seat never fabricates a party member', () => {
  // The captured shape: a roster holding somebody else's seat while the
  // client's own identity state points at an uninvolved character. Presence we cannot source is not rendered.
  const { party_rows } = fight_report_party_rows({
    roster: [{ id: ARES, name: 'ARES', team: 0, level: 12, is_player: true, alive: false }],
    me_id: null,
    ...defeat_args,
    me_name: 'SHOGO', // whatever the switcher currently points at may never become a presence claim
  })

  expect(party_rows.map((row) => row.id)).toEqual([ARES])
  expect(party_rows.some((row) => row.id === SHOGO || row.name === 'SHOGO')).toBe(false)
})

test('#1661 the local row is named off the SEAT, never off a stale roster name', () => {
  const { party_rows, my_team } = fight_report_party_rows({
    roster: [{ id: ARES, name: '0xdee0…ad38', team: 0, level: 12, is_player: true, alive: false }],
    me_id: ARES,
    ...defeat_args,
  })

  expect(my_team).toBe(0)
  expect(party_rows).toHaveLength(1)
  expect(party_rows[0]).toMatchObject({
    id: ARES,
    name: 'ARES',
    is_me: true,
    alive: false,
    // #1993 WP7 — this roster row carries no final vitals, so the card draws NO bar. It used to be given a
    // fabricated 0% purely because the row read `alive: false`.
    hp_pct: null,
    class_name: 'Senshi',
  })
})

test('a KNOWN seat the roster lost is still synthesized — a dungeon claim can escrow-remove the dead player', () => {
  const { party_rows } = fight_report_party_rows({
    roster: [{ id: '0xally', name: 'ALLY', team: 0, level: 9, is_player: true, alive: true }],
    me_id: ARES,
    ...defeat_args,
  })

  expect(party_rows.map((row) => row.id)).toEqual([ARES, '0xally'])
  expect(party_rows[0]).toMatchObject({ name: 'ARES', is_me: true, alive: false })
  expect(party_rows[1]).toMatchObject({ name: 'ALLY', is_me: false, alive: true })
})

test('a roster that raced away empty still renders ONE local row — anonymous, never a named alt', () => {
  const { party_rows } = fight_report_party_rows({ roster: [], me_id: null, ...defeat_args, me_name: null })

  expect(party_rows).toHaveLength(1)
  expect(party_rows[0]).toMatchObject({ name: 'You', is_me: true, is_player: true })
})

test('the victory card projects the same way — the winning seat, alive', () => {
  const { party_rows } = fight_report_party_rows({
    roster: [{ id: ARES, name: 'ARES', team: 0, level: 13, is_player: true, alive: true }],
    me_id: ARES,
    me_name: 'ARES',
    my_level: 13,
    my_class: 'Senshi',
    self_alive: true,
    fallback_name: 'You',
  })

  expect(party_rows).toHaveLength(1)
  // #1993 WP7 — no captured vitals ⇒ no bar (it used to be a fabricated full one off `alive: true`).
  expect(party_rows[0]).toMatchObject({ id: ARES, is_me: true, alive: true, hp_pct: null, level: 13 })
})

test('#1993 WP7 — a seat that ended on real HP is drawn at that exact fraction', () => {
  const { party_rows } = fight_report_party_rows({
    roster: [{ id: ARES, name: 'ARES', team: 0, level: 13, is_player: true, alive: true, final_hp: 9, max_hp: 60 }],
    me_id: ARES,
    me_name: 'ARES',
    my_level: 13,
    my_class: 'Senshi',
    self_alive: true,
    fallback_name: 'You',
  })

  expect(party_rows[0].hp_pct).toBe(15)
})
