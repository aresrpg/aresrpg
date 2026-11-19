// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { AuthSession } from '../../src/auth.ts'
import {
  create_landing_account,
  initial_landing_account,
  play_step,
  reduce_landing_account,
} from '../../src/landing/landing_account.ts'
import { create_remembered_auth } from '../../src/remembered_auth.ts'

const session = {
  address: '0x7a3f',
  wallet_name: 'Sign in with Google',
  identity: 'zklogin',
  disconnect: async () => undefined,
}
const account_with = (
  connect: () => Promise<AuthSession>,
  remembered: boolean,
  join?: (session: AuthSession) => Promise<void>
) => {
  const values = new Map(remembered ? [['last_wallet', 'Sign in with Google']] : [])
  return create_landing_account(
    create_remembered_auth(async () => ({ connect_google: connect, restore: connect, dispose: () => undefined }), {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    }),
    join
  )
}
const signed_in = async (): Promise<AuthSession> => session as unknown as AuthSession
const rejected = async (): Promise<AuthSession> => {
  throw new Error('popup closed')
}

test('a sign-in result is ignored unless a sign-in is in flight', () => {
  const connected = { type: 'connected', address: '0x1' } as const
  expect(reduce_landing_account(initial_landing_account, connected)).toBe(initial_landing_account)
  const connecting = reduce_landing_account(initial_landing_account, { type: 'connect' })
  expect(reduce_landing_account(connecting, { type: 'connect' })).toBe(connecting)
  expect(reduce_landing_account(connecting, connected)).toEqual({
    status: 'signed_in',
    address: '0x1',
    failed: false,
    waitlist: 'idle',
  })
})

test('only a signed-in account joins the waitlist, once, and a result counts only while a request is in flight', () => {
  const step = (state: typeof initial_landing_account, next: 'joining' | 'joined' | 'failed') =>
    reduce_landing_account(state, { type: 'waitlist', step: next })
  expect(step(initial_landing_account, 'joining')).toBe(initial_landing_account)
  const signed = reduce_landing_account(reduce_landing_account(initial_landing_account, { type: 'connect' }), {
    type: 'connected',
    address: '0x1',
  })
  expect(step(signed, 'joined')).toBe(signed)
  const joining = step(signed, 'joining')
  expect(joining.waitlist).toBe('joining')
  expect(step(joining, 'joining')).toBe(joining)
  const failed = step(joining, 'failed')
  expect(step(failed, 'joining').waitlist).toBe('joining')
  const joined = step(joining, 'joined')
  expect(step(joined, 'joining')).toBe(joined)
  expect(reduce_landing_account(joined, { type: 'signed_out' })).toBe(initial_landing_account)
})

test('joining the waitlist signs in first, sends one request for repeated presses and can be retried after a failure', async () => {
  const calls: AuthSession[] = []
  const account = account_with(signed_in, false, async (wallet) => {
    calls.push(wallet)
    if (calls.length === 1) throw new Error('offline')
  })
  await Promise.all([account.join_waitlist(), account.join_waitlist()])
  expect(calls).toEqual([session as unknown as AuthSession])
  expect(account.store.getState()).toMatchObject({ status: 'signed_in', waitlist: 'failed' })
  await account.join_waitlist()
  expect(account.store.getState().waitlist).toBe('joined')
  await account.join_waitlist()
  expect(calls).toHaveLength(2)
})

test('a visitor whose sign-in does not complete joins nothing, and a result for a signed-out account is dropped', async () => {
  const refused = account_with(rejected, false, async () => {
    throw new Error('must not be called')
  })
  await refused.join_waitlist()
  expect(refused.store.getState()).toEqual({ ...initial_landing_account, failed: true })
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const account = account_with(signed_in, false, () => pending)
  const joining = account.join_waitlist()
  await Bun.sleep(0)
  expect(account.store.getState().waitlist).toBe('joining')
  await account.logout()
  finish()
  await joining
  expect(account.store.getState()).toEqual(initial_landing_account)
})

test('a failed sign-in is shown, a remembered wallet that no longer restores is not', async () => {
  const fresh = account_with(rejected, false)
  expect(await fresh.login()).toBe(false)
  expect(fresh.store.getState()).toEqual({ ...initial_landing_account, failed: true })
  const stale = account_with(rejected, true)
  expect(stale.returning).toBe(true)
  expect(await stale.restore()).toBe(false)
  expect(stale.store.getState()).toEqual(initial_landing_account)
})

test('restore signs a returning visitor in, login is then already done, and logout returns to signed out', async () => {
  const account = account_with(signed_in, true)
  expect(await account.restore()).toBe(true)
  expect(account.store.getState().status).toBe('signed_in')
  expect(await account.login()).toBe(true)
  await account.logout()
  expect(account.store.getState()).toEqual(initial_landing_account)
})

test('a first-time visitor has nothing to restore', async () => {
  const account = account_with(signed_in, false)
  expect(account.returning).toBe(false)
  expect(await account.restore()).toBe(false)
  expect(account.store.getState()).toEqual(initial_landing_account)
})

// Regression: Play awaited the boot-time restore promise and then called itself. After a restored player
// logged out, that promise was already settled, so Play re-entered itself forever and froze the tab.
test('after a restored player logs out, Play asks for sign-in and never waits on the settled restore', async () => {
  const account = account_with(signed_in, true)
  expect(play_step(account.store.getState().status)).toBe('login')
  const restoring = account.restore()
  expect(play_step(account.store.getState().status)).toBe('wait')
  await restoring
  expect(play_step(account.store.getState().status)).toBe('enter')
  await account.logout()
  expect(play_step(account.store.getState().status)).toBe('login')
})
