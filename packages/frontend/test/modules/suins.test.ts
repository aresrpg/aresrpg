// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_app } from '../../src/store.ts'

const tick = () => Bun.sleep(0)
const snapshot = { default_name: null, names: [] }

test('Settings loads names once and duplicate clicks submit only one selection', async () => {
  const app = create_app()
  let reads = 0
  let writes = 0
  const completed = Promise.withResolvers<{ ok: true; name: string; digest: string }>()
  const wallet = {
    address: '0x1',
    suins: {
      snapshot: async () => {
        reads += 1
        return snapshot
      },
      set_default: async (name: string) => {
        writes += 1
        expect(name).toBe('sceat@sceat')
        return completed.promise
      },
    },
  }
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet as never })
  const stop = app.observe(['suins'])
  try {
    app.dispatch({ type: 'page/open', page: 'settings' })
    await tick()
    expect(reads).toBe(1)
    app.dispatch({ type: 'suins/name_changed', name: 'sceat@sceat' })
    app.dispatch({ type: 'suins/use' })
    app.dispatch({ type: 'suins/use' })
    app.dispatch({ type: 'suins/refresh' })
    expect(writes).toBe(1)
    completed.resolve({ ok: true, name: 'sceat.sceat.sui', digest: 'confirmed' })
    await tick()
    expect(app.store.getState().suins).toMatchObject({
      snapshot: { default_name: 'sceat.sceat.sui' },
      request: null,
      confirmed: true,
    })
    expect(reads).toBe(1)
  } finally {
    stop()
  }
})

test('a completed selection from an old wallet cannot overwrite a new wallet', async () => {
  const app = create_app()
  const completed = Promise.withResolvers<{ ok: true; name: string; digest: string }>()
  const connect = (address: string) => {
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({
      type: 'auth/connected',
      session: {
        address,
        suins: {
          snapshot: async () => snapshot,
          set_default: async () => completed.promise,
        },
      } as never,
    })
  }
  connect('0x1')
  const stop = app.observe(['suins'])
  try {
    app.dispatch({ type: 'suins/name_changed', name: 'old.sui' })
    app.dispatch({ type: 'suins/use' })
    app.dispatch({ type: 'auth/disconnected' })
    connect('0x2')
    completed.resolve({ ok: true, name: 'old.sui', digest: 'confirmed' })
    await tick()
    expect(app.store.getState().suins).toMatchObject({ snapshot: null, draft: '', request: null, confirmed: false })
  } finally {
    stop()
  }
})

test('a failed selection is reported and never automatically retried', async () => {
  const app = create_app()
  let writes = 0
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({
    type: 'auth/connected',
    session: {
      suins: {
        snapshot: async () => snapshot,
        set_default: async () => {
          writes += 1
          throw new Error('outcome unknown')
        },
      },
    } as never,
  })
  const stop = app.observe(['suins'])
  try {
    app.dispatch({ type: 'suins/name_changed', name: 'mine.sui' })
    app.dispatch({ type: 'suins/use' })
    await tick()
    app.dispatch({ type: 'page/open', page: 'world' })
    app.dispatch({ type: 'page/open', page: 'settings' })
    await tick()
    expect(writes).toBe(1)
    expect(app.store.getState().suins.confirmed).toBe(false)
  } finally {
    stop()
  }
})
