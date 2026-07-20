import { afterEach, describe, expect, mock, test } from 'bun:test'

import { get_owner_by_name } from './friends_reads.js'

const real_fetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = real_fetch
})

describe('get_owner_by_name', () => {
  test('calls the /v1 names endpoint and preserves its match metadata', async () => {
    const match = {
      name: 'qasenshi',
      character_id: '0xcharacter',
      owner: `0x${'a'.repeat(64)}`,
      level: 42,
      class: 'senshi',
    }
    let requested_url = ''
    globalThis.fetch = mock(async (url) => {
      requested_url = String(url)
      return new Response(JSON.stringify({ matches: [match] }), { status: 200 })
    })

    expect(await get_owner_by_name('  QaSenShi  ')).toEqual([match])
    const url = new URL(requested_url)
    expect(url.pathname).toBe('/v1/names')
    expect(url.searchParams.get('name')).toBe('QaSenShi')
  })

  test('blank input short-circuits without a request', async () => {
    const fetch_mock = mock(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetch_mock
    expect(await get_owner_by_name('   ')).toEqual([])
    expect(fetch_mock).not.toHaveBeenCalled()
  })

  test('a 400 (input cannot be a character name) resolves to no matches, not a throw', async () => {
    // The char-name endpoint 400s anything outside 4–19 printable ASCII. That is a definitive "no character
    // by that name", so the add flow surfaces an honest "no character named X" / falls through to the SuiNS
    // fallback — never the generic "couldn't look up" toast.
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 }))
    expect(await get_owner_by_name('a-name-far-too-long-to-be-a-character')).toEqual([])
  })

  test('a non-400 failure still propagates (a real outage is not "no player")', async () => {
    globalThis.fetch = mock(async () => new Response('degraded', { status: 503 }))
    expect(get_owner_by_name('aiden')).rejects.toThrow()
  })
})
