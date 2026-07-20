// Offline unit coverage for the `/v1/names?name=` branch. views.test.js remains the real Redis integration
// oracle; these injected reads keep validation/keying/shaping executable in the network/Redis-free sandbox.

import { describe, expect, mock, test } from 'bun:test'

import { handle_names } from './views.js'

const params = (name) => new URLSearchParams({ name })
const character = `0x${'c'.repeat(64)}`
const creator = `0x${'1'.repeat(64)}`
const current_owner = `0x${'2'.repeat(64)}`
const kiosk = `0x${'3'.repeat(64)}`

function reads(index = [], docs = new Map()) {
  return {
    smembers: mock(async () => index),
    mget_json: mock(async (keys) => keys.map((key) => docs.get(key) ?? null)),
  }
}

describe('/v1/names character-name view', () => {
  test('a valid name with an empty index returns an empty matches array (200, never a 404)', async () => {
    const store = reads()
    const { status, data } = await handle_names(params('Nobody'), store)
    // A miss stays 200 { matches: [] }, never a 404 — the sole consumer (friends_reads.js:get_owner_by_name)
    // reads body.matches, and rpc_get THROWS on any non-2xx, so a 404 here surfaces as the generic
    // "couldn't look up that player name" toast instead of the honest "no player by that name" branch.
    expect(status).toBe(200)
    expect(data).toEqual({ matches: [] })
    expect(store.smembers).toHaveBeenCalledWith('rpc:idx:char_name:nobody')
  })

  test('a hit returns the owning address inside the matches array the frontend consumes', async () => {
    const docs = new Map([
      [
        `rpc:character:${character}`,
        { id: character, name: 'aiden', owner: creator, kiosk_id: kiosk, level: 12, class: 'sram' },
      ],
      [`rpc:kiosk:${kiosk}`, { kiosk_id: kiosk, owner: current_owner }],
    ])
    const store = reads([character], docs)
    const { status, data } = await handle_names(params('aiden'), store)
    expect(status).toBe(200)
    expect(data).toEqual({
      matches: [{ name: 'aiden', character_id: character, owner: creator, level: 12, class: 'sram' }],
    })
    expect(store.mget_json).toHaveBeenCalledTimes(1)
    expect(store.mget_json).toHaveBeenCalledWith([`rpc:character:${character}`])
  })

  // The seam guard: friends_reads.js:get_owner_by_name throws 'malformed response' unless body.matches is an
  // array, and friend_target.js only reads matches[0].owner. Both hit and miss MUST carry a matches array —
  // its absence is the exact drift that produced the "couldn't look up that player name" toast.
  test('every ?name= response carries a matches array (the get_owner_by_name contract)', async () => {
    const docs = new Map([
      [`rpc:character:${character}`, { id: character, name: 'aiden', owner: creator, level: 12, class: 'sram' }],
    ])
    const hit = await handle_names(params('aiden'), reads([character], docs))
    const miss = await handle_names(params('nobody'), reads())
    expect(Array.isArray(hit.data.matches)).toBe(true)
    expect(Array.isArray(miss.data.matches)).toBe(true)
    expect(hit.data.matches[0].owner).toBe(creator)
  })

  test('lookup lowercases mixed-case input before reading the exact index', async () => {
    const store = reads()
    await handle_names(params('AiDeN'), store)
    expect(store.smembers).toHaveBeenCalledWith('rpc:idx:char_name:aiden')
  })

  test.each(['', 'abc', 'a'.repeat(20), '英雄'])('rejects malformed input without touching Redis: %p', async (name) => {
    const store = reads()
    const { status, data } = await handle_names(params(name), store)
    expect(status).toBe(400)
    expect(data.error).toBe('bad_request')
    expect(store.smembers).not.toHaveBeenCalled()
    expect(store.mget_json).not.toHaveBeenCalled()
  })

  test.each([
    ['missing character document', null],
    ['mismatched character document', { id: character, name: 'other', owner: creator }],
    ['character document without an owner', { id: character, name: 'aiden' }],
  ])('%s returns an empty matches array', async (_label, document) => {
    const docs = new Map([[`rpc:character:${character}`, document]])
    const { status, data } = await handle_names(params('aiden'), reads([character], docs))
    expect(status).toBe(200)
    expect(data).toEqual({ matches: [] })
  })
})
