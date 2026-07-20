import { afterAll, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../rpc/client'

const calls = []
const projected = {
  id: '0xparty',
  leader_character: '0xleader',
  members: [{ character: '0xleader', owner: '0xowner', order: 0 }],
}

const rpc_get = spyOn(rpc_client, 'rpc_get').mockImplementation(async (...args) => {
  calls.push(args)
  return projected
})
afterAll(() => rpc_get.mockRestore())

const { get_party } = await import('./read_party.js')

test('party read is the exact selected-character /v1 projection', async () => {
  const { signal } = new AbortController()
  expect(await get_party('0xselected', signal)).toEqual(projected)
  expect(calls).toEqual([['/v1/parties', { character: '0xselected' }, signal]])
})

test('missing character stays local and never issues an owner/object read', async () => {
  calls.length = 0
  expect(await get_party('')).toBe(null)
  expect(calls).toEqual([])
})
