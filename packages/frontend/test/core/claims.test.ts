// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { claim_is_settleable } from '../../src/modules/claims.ts'

// REPORTED 2026-08-22: opening a pet box raised "The rolled item is not in the authored
// catalog" and left the reveal button spinning on Collecting… forever. The catalog was fine —
// `inventory/box_opened` folds the claim from the receipt as { id, kind } alone, because the
// open receipt names the CLAIM and not what it rolled. The silent claimer settled it anyway,
// read an absent template, and threw. The roll belongs to the projection's streamed row.
test('a box claim is settleable only once the projection has told us what it rolled', () => {
  expect(claim_is_settleable({ id: '0x1', kind: 'box' })).toBeFalse()
  expect(claim_is_settleable({ id: '0x1', kind: 'box', rolled_template: '' })).toBeFalse()
  expect(claim_is_settleable({ id: '0x1', kind: 'box', rolled_template: '0xabc' })).toBeTrue()
})

// a crush yield carries no roll — its contents are the rune set, known from the catalog alone
test('a crush claim never waits on a projected roll', () => {
  expect(claim_is_settleable({ id: '0x2', kind: 'crush' })).toBeTrue()
  expect(claim_is_settleable({ id: '0x2', kind: 'crush', amount: 3 })).toBeTrue()
})

// Automatic intent survives observer/reload lifetimes; only explicit recovery can submit again.
test('a failed claim is attempted once across reloads, then explicit recovery reaches the SDK', async () => {
  const { create_app } = await import('../../src/store.ts')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
  let calls = 0
  const wallet = {
    address: '0xclaimant',
    character: {
      redeem_crush: async () => {
        calls++
        throw new Error('transaction outcome uncertain')
      },
    },
  }
  const load = () => {
    const app = create_app()
    const stop = app.observe(['claims'])
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet as never })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/claims', claims: [{ id: '0xclaim', kind: 'crush' }] },
    })
    return { app, stop }
  }
  try {
    const first = load()
    await new Promise((resolve) => setTimeout(resolve, 0))
    first.stop()
    const second = load()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    second.app.dispatch({ type: 'claims/redeem', claim_id: '0xclaim' } as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(2)
    second.stop()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('unavailable persistence disables automation but explicit recovery remains reachable', async () => {
  const { create_app } = await import('../../src/store.ts')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: null })
  let calls = 0
  const app = create_app()
  const stop = app.observe(['claims'])
  try {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({
      type: 'auth/connected',
      session: {
        address: '0xdenied',
        character: {
          redeem_crush: async () => {
            calls++
            return { digest: 'manual', item_ids: [] }
          },
        },
      } as never,
    })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/claims', claims: [{ id: '0xmanual', kind: 'crush' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(0)
    app.dispatch({ type: 'claims/redeem', claim_id: '0xmanual' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(app.store.getState().session.claims).toEqual([])
  } finally {
    stop()
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('late claim settlement cannot remove another account claim or publish its yield', async () => {
  const { create_app } = await import('../../src/store.ts')
  let resolve_claim: (result: { digest: string; item_ids: string[] }) => void = () => undefined
  const app = create_app()
  const stop = app.observe(['claims'])
  const claim = { id: '0xsharedprojection', kind: 'crush' as const }
  const login = (wallet: unknown) => {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet as never })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/claims', claims: [claim] } })
  }
  login({
    address: '0xold',
    character: {
      redeem_crush: () =>
        new Promise((resolve) => {
          resolve_claim = resolve
        }),
    },
  })
  app.dispatch({ type: 'claims/redeem', claim_id: claim.id })
  app.dispatch({ type: 'auth/disconnected' })
  login({
    address: '0xnew',
    character: {
      redeem_crush: async () => {
        throw new Error('unexpected automatic retry')
      },
    },
  })
  resolve_claim({ digest: 'old', item_ids: [] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(app.store.getState().session.claims).toEqual([claim])
  stop()
})
