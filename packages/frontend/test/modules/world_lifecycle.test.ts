// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'

import type { AuthSession } from '../../src/auth.ts'
import { create_app } from '../../src/store.ts'

import { character } from './automation_fixture.ts'

for (const completed of [false, true]) {
  test(`world disposal releases search timers when receipt completed=${completed}`, async () => {
    const app = create_app()
    let resolve!: (value: { digest: string }) => void
    const receipt = new Promise<{ digest: string }>((done) => {
      resolve = done
    })
    const wallet = { address: 'owner', character: { search_zone: () => receipt } } as unknown as AuthSession
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet })
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character()] } })
    const timer = spyOn(globalThis, 'setTimeout')
    const clear = spyOn(globalThis, 'clearTimeout')
    const close = app.observe(['world'])
    try {
      app.dispatch({
        type: 'world/search_zone',
        target: {
          key: 'nauvis:98:97',
          world: 'nauvis',
          x: 50_200,
          z: 50_000,
          kind: 'discover',
          previous_searched_at_ms: null,
        },
      })
      if (completed) {
        resolve({ digest: 'test' })
        await receipt
      }
      close()
      const disposed = app.store.getState()
      resolve({ digest: 'test' })
      await receipt
      await Promise.resolve()
      const arrivals = timer.mock.calls.flatMap((call, index) =>
        call[1] === 30_000 ? [timer.mock.results[index]!.value] : []
      )
      if (completed) {
        expect(arrivals).toHaveLength(1)
        expect(clear).toHaveBeenCalledWith(arrivals[0])
      } else expect(arrivals).toHaveLength(0)
      expect(app.store.getState()).toBe(disposed)
    } finally {
      close()
      timer.mock.results.forEach((result) => {
        if (result.type === 'return') clearTimeout(result.value)
      })
      timer.mockRestore()
      clear.mockRestore()
    }
  })
}
