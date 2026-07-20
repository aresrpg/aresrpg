import { describe, expect, mock, test } from 'bun:test'

import { resolve_friend_target, submit_friend_target } from './friend_target.js'

const owner = `0x${'a'.repeat(64)}`

describe('friend target resolution', () => {
  test.each([`0x${'B'.repeat(64)}`, '0xnot-an-address'])(
    '%s uses the address path without a name read',
    async (input) => {
      const find_by_name = mock(async () => [])
      const add_address = mock(async () => {})

      const result = await submit_friend_target(input, { find_by_name, add_address })

      expect(result).toMatchObject({ kind: 'resolved', source: 'address', address: input.toLowerCase() })
      expect(find_by_name).not.toHaveBeenCalled()
      expect(add_address).toHaveBeenCalledWith(input.toLowerCase())
    }
  )

  test('a unique player name enters the existing add flow with the resolved owner', async () => {
    const find_by_name = mock(async (name) => [
      { name: name.toLowerCase(), character_id: '0xcharacter', owner: owner.toUpperCase(), level: 12, class: 'sram' },
    ])
    const add_address = mock(async () => {})

    const result = await submit_friend_target('  Aiden  ', { find_by_name, add_address })

    expect(find_by_name).toHaveBeenCalledWith('Aiden')
    expect(result).toMatchObject({ kind: 'resolved', source: 'name', address: owner })
    expect(add_address).toHaveBeenCalledWith(owner)
  })

  test('zero matches (plain name, no SuiNS form) performs no add and reports via:name', async () => {
    const add_address = mock(async () => {})
    const result = await submit_friend_target('Nobody', { find_by_name: async () => [], add_address })
    expect(result).toEqual({ kind: 'not_found', via: 'name', matches: [] })
    expect(add_address).not.toHaveBeenCalled()
  })

  test('a SuiNS handle resolves through the fallback when no character matches', async () => {
    const add_address = mock(async () => {})
    const result = await submit_friend_target('alice.sui', {
      find_by_name: async () => [],
      find_by_suins: async () => owner,
      looks_like_suins: (v) => v.endsWith('.sui'),
      add_address,
    })
    expect(result).toMatchObject({ kind: 'resolved', source: 'suins', address: owner })
    expect(add_address).toHaveBeenCalledWith(owner)
  })

  test('character is tried BEFORE SuiNS — a name hit never calls the SuiNS resolver', async () => {
    const find_by_suins = mock(async () => owner)
    const result = await submit_friend_target('aiden', {
      find_by_name: async () => [{ name: 'aiden', owner, level: 1, class: 'sram' }],
      find_by_suins,
      looks_like_suins: () => true,
      add_address: async () => {},
    })
    expect(result).toMatchObject({ kind: 'resolved', source: 'name' })
    expect(find_by_suins).not.toHaveBeenCalled()
  })

  test('a SuiNS-shaped miss reports via:suins so the toast blames the handle lookup', async () => {
    const result = await submit_friend_target('ghost.sui', {
      find_by_name: async () => [],
      find_by_suins: async () => null,
      looks_like_suins: (v) => v.endsWith('.sui'),
      add_address: async () => {},
    })
    expect(result).toMatchObject({ kind: 'not_found', via: 'suins' })
  })

  test('a plain-name miss reports via:name and never touches SuiNS', async () => {
    const find_by_suins = mock(async () => owner)
    const result = await submit_friend_target('Nobody', {
      find_by_name: async () => [],
      find_by_suins,
      looks_like_suins: () => false,
      add_address: async () => {},
    })
    expect(result).toMatchObject({ kind: 'not_found', via: 'name' })
    expect(find_by_suins).not.toHaveBeenCalled()
  })

  test('multiple matches fail closed and expose rows without choosing an owner', async () => {
    const matches = [
      { name: 'legacy', owner, level: 1, class: 'sram' },
      { name: 'legacy', owner: `0x${'b'.repeat(64)}`, level: 2, class: 'iop' },
    ]
    const add_address = mock(async () => {})
    const result = await submit_friend_target('Legacy', { find_by_name: async () => matches, add_address })
    expect(result).toEqual({ kind: 'ambiguous', matches })
    expect(add_address).not.toHaveBeenCalled()
  })

  test('blank input is invalid without a lookup', async () => {
    const find_by_name = mock(async () => [])
    expect(await resolve_friend_target('   ', { find_by_name })).toEqual({ kind: 'invalid' })
    expect(find_by_name).not.toHaveBeenCalled()
  })
})
