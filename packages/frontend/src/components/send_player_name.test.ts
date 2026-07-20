import { describe, expect, mock, test } from 'bun:test'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'

// Both modal module graphs reach browser-only Enoki registration through auth. Keep this DOM-less unit surface
// isolated with the same complete auth mock shape used by the other component-adjacent tests.
reset_auth_mock()

const { resolve_sui_player_recipient } = await import('./send_sui_modal')
const { resolve_item_player_recipient } = await import('./item_send_modal')

const OWNER = `0x${'3'.repeat(64)}`
const RAW_ADDRESS = `0x${'a'.repeat(64)}`
const PLAYER = { name: 'alice', character_id: '0xcharacter', owner: OWNER }

const resolvers = [
  ['SUI', resolve_sui_player_recipient],
  ['item', resolve_item_player_recipient],
] as const

for (const [label, resolve_recipient] of resolvers) {
  describe(`${label} send player-name resolution`, () => {
    test('exact-name success substitutes the indexed owner address', async () => {
      const lookup = mock(async () => PLAYER)

      expect(await resolve_recipient('  alice  ', lookup)).toEqual({
        kind: 'resolved',
        name: 'alice',
        address: OWNER,
      })
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(lookup).toHaveBeenCalledWith('alice')
    })

    test('404 is a blocked not-found result', async () => {
      const lookup = mock(async () => {
        throw Object.assign(new Error('HTTP 404'), { status: 404 })
      })

      expect(await resolve_recipient('missing-player', lookup)).toEqual({ kind: 'not_found' })
      expect(lookup).toHaveBeenCalledTimes(1)
    })

    test('a full 0x address passes through unchanged without lookup', async () => {
      const lookup = mock(async () => PLAYER)

      expect(await resolve_recipient(RAW_ADDRESS, lookup)).toEqual({
        kind: 'passthrough',
        address: RAW_ADDRESS,
      })
      expect(lookup).not.toHaveBeenCalled()
    })

    test('a 3-character non-0x input never fires lookup', async () => {
      const lookup = mock(async () => PLAYER)

      expect(await resolve_recipient('abc', lookup)).toEqual({ kind: 'blocked' })
      expect(lookup).not.toHaveBeenCalled()
    })

    test('a malformed 0x-prefixed input never falls through to player lookup', async () => {
      const lookup = mock(async () => PLAYER)

      expect(await resolve_recipient('0xzzzz', lookup)).toEqual({ kind: 'blocked' })
      expect(lookup).not.toHaveBeenCalled()
    })

    test('SuiNS remains outside the player lookup path', async () => {
      const lookup = mock(async () => PLAYER)

      expect(await resolve_recipient('alice.sui', lookup)).toEqual({ kind: 'blocked' })
      expect(lookup).not.toHaveBeenCalled()
    })

    test('non-404 lookup failure is distinct from not found', async () => {
      const lookup = mock(async () => {
        throw new Error('network unavailable')
      })

      expect(await resolve_recipient('alice', lookup)).toEqual({ kind: 'failed' })
      expect(lookup).toHaveBeenCalledTimes(1)
    })
  })
}
