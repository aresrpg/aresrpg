// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, mock, test } from 'bun:test'

import { handle_parties, handle_party_invites } from './parties_view.js'

const party_id = `0x${'a'.repeat(64)}`
const leader = `0x${'1'.repeat(64)}`
const alt = `0x${'2'.repeat(64)}`
const friend = `0x${'3'.repeat(64)}`
const shared_owner = `0x${'b'.repeat(64)}`
const friend_owner = `0x${'c'.repeat(64)}`
const new_owner = `0x${'d'.repeat(64)}`
const kiosk_id = `0x${'e'.repeat(64)}`

const params = (character) => new URLSearchParams(character == null ? {} : { character })

function reads(entries = [], sets = []) {
  const docs = new Map(entries)
  const members = new Map(sets)
  return {
    get_json: mock(async (key) => docs.get(key) ?? null),
    mget_json: mock(async (keys) => keys.map((key) => docs.get(key) ?? null)),
    smembers: mock(async (key) => members.get(key) ?? []),
  }
}

describe('/v1/parties?character=', () => {
  test('requires a character id before reading Redis', async () => {
    const store = reads()
    const { status, data } = await handle_parties(params(), store)
    expect(status).toBe(400)
    expect(data).toEqual({ error: 'bad_request', message: 'provide ?character=<character id>' })
    expect(store.get_json).not.toHaveBeenCalled()
  })

  test('returns null when the character has no projected party', async () => {
    const store = reads()
    const { status, data } = await handle_parties(params(leader), store)
    expect(status).toBe(200)
    expect(data).toBeNull()
    expect(store.get_json).toHaveBeenCalledWith(`rpc:char_party:${leader}`)
  })

  test('returns the deterministic character-keyed shape and preserves same-owner alts', async () => {
    const store = reads([
      [`rpc:char_party:${alt}`, party_id],
      [
        `rpc:party:${party_id}`,
        {
          id: party_id,
          leader_character: leader,
          members: [
            { character: friend, owner: friend_owner, order: 2, ignored: true },
            { character: alt, owner: shared_owner, order: 1 },
            { character: leader, owner: shared_owner, order: 0 },
          ],
          pending: ['not part of the public view'],
        },
      ],
    ])

    const { status, data } = await handle_parties(params(alt), store)
    expect(status).toBe(200)
    expect(data).toEqual({
      id: party_id,
      leader_character: leader,
      members: [
        { character: leader, owner: shared_owner, order: 0 },
        { character: alt, owner: shared_owner, order: 1 },
        { character: friend, owner: friend_owner, order: 2 },
      ],
    })
  })

  test('fails closed when a stale pointer targets a party without the queried character', async () => {
    const store = reads([
      [`rpc:char_party:${alt}`, party_id],
      [
        `rpc:party:${party_id}`,
        {
          id: party_id,
          leader_character: leader,
          members: [{ character: leader, owner: shared_owner, order: 0 }],
        },
      ],
    ])
    const { data } = await handle_parties(params(alt), store)
    expect(data).toBeNull()
  })

  test('resolves a transferred character through its current personal kiosk owner', async () => {
    const store = reads([
      [`rpc:char_party:${leader}`, party_id],
      [
        `rpc:party:${party_id}`,
        {
          id: party_id,
          leader_character: leader,
          members: [{ character: leader, owner: shared_owner, order: 0 }],
        },
      ],
      [`rpc:character:${leader}`, { id: leader, kiosk_id }],
      [`rpc:kiosk:${kiosk_id}`, { kiosk_id, owner: new_owner }],
    ])

    const { data } = await handle_parties(params(leader), store)
    expect(data.members).toEqual([{ character: leader, owner: new_owner, order: 0 }])
  })
})

// ROW #2008: pending invites are the ONE dimension `/v1/parties` structurally cannot serve — the invitee is by
// definition NOT a member, so its `rpc:char_party` pointer is absent and the membership check fails closed. The
// sibling route is the authoritative carrier the invitee polls; `party::invite` emits no event, so the row comes
// from the Party OBJECT snapshot (indexer/src/handlers/ares/party.rs).
describe('/v1/party-invites?character=', () => {
  const pending_key = (party) => `rpc:party_invites:${party}`
  const index_key = (character) => `rpc:idx:char_invites:${character}`
  const second_party = `0x${'f'.repeat(64)}`

  test('requires a character id before reading Redis', async () => {
    const store = reads()
    const { status, data } = await handle_party_invites(params(), store)
    expect(status).toBe(400)
    expect(data).toEqual({ error: 'bad_request', message: 'provide ?character=<character id>' })
    expect(store.smembers).not.toHaveBeenCalled()
  })

  test('serves an empty list — never null — when nobody has invited the character', async () => {
    const store = reads()
    const { status, data } = await handle_party_invites(params(friend), store)
    expect(status).toBe(200)
    expect(data).toEqual([])
    expect(store.smembers).toHaveBeenCalledWith(index_key(friend))
  })

  test('serves the pending row a non-member character can accept, with its inviting leader', async () => {
    const store = reads(
      [
        [pending_key(party_id), { party: party_id, invites: [{ character: friend, owner: friend_owner }] }],
        [
          `rpc:party:${party_id}`,
          { id: party_id, leader_character: leader, members: [{ character: leader, owner: shared_owner, order: 0 }] },
        ],
      ],
      [[index_key(friend), [party_id]]]
    )

    const { status, data } = await handle_party_invites(params(friend), store)
    expect(status).toBe(200)
    expect(data).toEqual([{ party: party_id, leader_character: leader }])
  })

  test('fails closed on a stale index entry the pending document no longer lists', async () => {
    const store = reads(
      [
        [pending_key(party_id), { party: party_id, invites: [{ character: alt, owner: shared_owner }] }],
        [
          `rpc:party:${party_id}`,
          { id: party_id, leader_character: leader, members: [{ character: leader, owner: shared_owner, order: 0 }] },
        ],
      ],
      [[index_key(friend), [party_id]]]
    )
    const { data } = await handle_party_invites(params(friend), store)
    expect(data).toEqual([])
  })

  test('drops an invite for a character the party already accepted, and one with no projected party yet', async () => {
    const store = reads(
      [
        [pending_key(party_id), { party: party_id, invites: [{ character: friend, owner: friend_owner }] }],
        [
          `rpc:party:${party_id}`,
          {
            id: party_id,
            leader_character: leader,
            members: [
              { character: leader, owner: shared_owner, order: 0 },
              { character: friend, owner: friend_owner, order: 1 },
            ],
          },
        ],
        [pending_key(second_party), { party: second_party, invites: [{ character: friend, owner: friend_owner }] }],
      ],
      [[index_key(friend), [party_id, second_party]]]
    )
    const { data } = await handle_party_invites(params(friend), store)
    expect(data).toEqual([])
  })

  test('orders multiple live invitations deterministically by party id', async () => {
    const party_doc = (id, leader_character) => [
      `rpc:party:${id}`,
      { id, leader_character, members: [{ character: leader_character, owner: shared_owner, order: 0 }] },
    ]
    const store = reads(
      [
        [pending_key(party_id), { party: party_id, invites: [{ character: friend, owner: friend_owner }] }],
        [pending_key(second_party), { party: second_party, invites: [{ character: friend, owner: friend_owner }] }],
        party_doc(party_id, leader),
        party_doc(second_party, alt),
      ],
      [[index_key(friend), [second_party, party_id]]]
    )
    const { data } = await handle_party_invites(params(friend), store)
    expect(data).toEqual([
      { party: party_id, leader_character: leader },
      { party: second_party, leader_character: alt },
    ])
  })
})
