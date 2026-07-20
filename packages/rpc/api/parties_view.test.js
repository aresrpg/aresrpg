import { describe, expect, mock, test } from 'bun:test'

import { handle_parties } from './parties_view.js'

const party_id = `0x${'a'.repeat(64)}`
const leader = `0x${'1'.repeat(64)}`
const alt = `0x${'2'.repeat(64)}`
const friend = `0x${'3'.repeat(64)}`
const shared_owner = `0x${'b'.repeat(64)}`
const friend_owner = `0x${'c'.repeat(64)}`
const new_owner = `0x${'d'.repeat(64)}`
const kiosk_id = `0x${'e'.repeat(64)}`

const params = (character) => new URLSearchParams(character == null ? {} : { character })

function reads(entries = []) {
  const docs = new Map(entries)
  return {
    get_json: mock(async (key) => docs.get(key) ?? null),
    mget_json: mock(async (keys) => keys.map((key) => docs.get(key) ?? null)),
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
