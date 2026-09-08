// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_suins_resolver } from '../src/suins.ts'

const address = (id: number): string => `0x${id.toString(16).padStart(64, '0')}`
const resolver_fixture = () => {
  const state = { now: 0, calls: 0, missing: false, mismatch: false }
  const client = {
    defaultNameServiceName: async ({ address }: Readonly<{ address: string }>) => {
      state.calls++
      return { data: { name: state.missing ? null : `${address}.sui` } }
    },
    resolveNameServiceAddress: async ({ name }: Readonly<{ name: string }>) => ({
      address: state.mismatch ? '0xwrong' : name.slice(0, -4),
    }),
  }
  return { state, resolve: create_suins_resolver({ client: client as never, now: () => state.now }) }
}

test('SuiNS keeps 2000 recently used addresses, refreshing recency on hits', async () => {
  const { resolve, state } = resolver_fixture()
  for (let i = 0; i < 2000; i++) await resolve(address(i))
  expect(state.calls).toBe(2000)
  await resolve(address(0))
  await resolve(address(2000))
  await resolve(address(0))
  expect(state.calls).toBe(2001)
  await resolve(address(1))
  expect(state.calls).toBe(2002)
})

test('positive and negative cache entries expire and reverse names must point back', async () => {
  const { resolve, state } = resolver_fixture()
  expect(await resolve(address(0))).toBe(`${address(0)}.sui`)
  state.now = 299_999
  await resolve(address(0))
  expect(state.calls).toBe(1)
  state.now++
  state.mismatch = true
  expect(await resolve(address(0))).toBeNull()
  state.mismatch = false
  state.now += 59_999
  expect(await resolve(address(0))).toBeNull()
  state.now++
  expect(await resolve(address(0))).toBe(`${address(0)}.sui`)
  state.missing = true
  expect(await resolve(address(5))).toBeNull()
})

test('coalesces in-flight names and bounds simultaneous RPC lookups', async () => {
  const waiting: (() => void)[] = []
  const state = { active: 0, maximum: 0, calls: 0 }
  const client = {
    defaultNameServiceName: async () => {
      state.calls++
      state.active++
      state.maximum = Math.max(state.maximum, state.active)
      await new Promise<void>((resolve) => waiting.push(resolve))
      state.active--
      return { data: { name: null } }
    },
    resolveNameServiceAddress: async () => ({ address: null }),
  }
  const resolve = create_suins_resolver({ client: client as never, concurrency: 4 })
  const requests = Array.from({ length: 12 }, (_, id) => resolve(address(id)))
  const duplicate = resolve(address(0))
  expect(duplicate).toBe(requests[0]!)
  while (state.calls < 12 || waiting.length) {
    waiting.splice(0).forEach((release) => release())
    await Bun.sleep(0)
  }
  await Promise.all([...requests, duplicate])
  expect(state.calls).toBe(12)
  expect(state.maximum).toBe(4)
})

test('temporary RPC failures have a short cache lifetime instead of triggering a retry storm', async () => {
  let now = 0
  let calls = 0
  const resolve = create_suins_resolver({
    now: () => now,
    client: {
      defaultNameServiceName: async () => {
        calls++
        throw new Error('temporary outage')
      },
      resolveNameServiceAddress: async () => ({ address: null }),
    } as never,
  })
  expect(await resolve(address(0))).toBeNull()
  expect(await resolve(address(0))).toBeNull()
  expect(calls).toBe(1)
  now = 10_000
  expect(await resolve(address(0))).toBeNull()
  expect(calls).toBe(2)
})
