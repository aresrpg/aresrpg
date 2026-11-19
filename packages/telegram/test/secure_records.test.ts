// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { secure_records } from '../src/secure_records.ts'

import { memory_backend } from './helpers/memory_backend.ts'

const key = 'ab'.repeat(32)

test('records are ciphertext bound to their id and readable only with the external key', async () => {
  const backend = memory_backend()
  const records = secure_records(backend, key)
  await records.change(['user:42'], () => ({ 'user:42': { value: { token: 'FIXTURE_SECRET_TOKEN' } } }))
  const [raw] = await backend.get(['user:42'])
  expect(raw).not.toContain('FIXTURE_SECRET_TOKEN')
  expect(Buffer.from(raw!, 'base64').includes(Buffer.from('FIXTURE_SECRET_TOKEN'))).toBe(false)
  expect(await records.read('user:42')).toEqual({ token: 'FIXTURE_SECRET_TOKEN' })
  await expect(secure_records(backend, 'cd'.repeat(32)).read('user:42')).rejects.toThrow()
  // The record id is the AAD: moving ciphertext to another id cannot decrypt.
  await backend.commit([{ id: 'user:43', raw: null }], [{ id: 'user:43', raw: raw!, expires_at: null }])
  await expect(records.read('user:43')).rejects.toThrow()
  expect(() => secure_records(backend, '')).toThrow('storage_key_required')
})

test('concurrent changes of one record fail closed instead of overwriting', async () => {
  const records = secure_records(memory_backend(), key)
  await records.change(['user:42'], () => ({ 'user:42': { value: { version: 0 } } }))
  const bump = (version: number) =>
    records.change(['user:42'], (get) => {
      expect(get<{ version: number }>('user:42')).toEqual({ version: 0 })
      return { 'user:42': { value: { version } } }
    })
  const outcomes = await Promise.allSettled([bump(1), bump(2)])
  expect(outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'rejected'])
  expect((outcomes[1] as PromiseRejectedResult).reason.message).toBe('link_changed')
  expect(await records.read('user:42')).toEqual({ version: 1 })
})

test('a write outside the compared records is refused', async () => {
  const records = secure_records(memory_backend(), key)
  await expect(records.change(['user:42'], () => ({ 'user:43': { value: 1 } }))).rejects.toThrow('record_not_locked')
  expect(await records.read('user:43')).toBeNull()
})

test('a record expires at its own absolute deadline and a null write deletes it', async () => {
  const clock = { now: 1000 }
  const records = secure_records(
    memory_backend(() => clock.now),
    key
  )
  await records.change(['pending:a', 'pending:b'], () => ({
    'pending:a': { value: 'a', expires_at: 2000 },
    'pending:b': { value: 'b' },
  }))
  clock.now = 1999
  expect(await records.read('pending:a')).toBe('a')
  clock.now = 2000
  expect(await records.read('pending:a')).toBeNull()
  expect(await records.ids('pending:')).toEqual(['pending:b'])
  await records.change(['pending:b'], () => ({ 'pending:b': null }))
  expect(await records.ids('pending:')).toEqual([])
})
