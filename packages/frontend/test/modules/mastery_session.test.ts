// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { MasteryRow } from '@aresrpg/protocol'

import { content_catalog } from '../../src/content/catalog.ts'
import { create_app } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'

const row = (owner: string, points = '1') => ({ id: owner, owner, points }) as MasteryRow
const login = (
  app: ReturnType<typeof create_app>,
  address: string,
  redeem: () => Promise<{ mastery: MasteryRow | null }>
) => {
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: { address, mastery: { redeem, start: redeem } } as never })
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/mastery',
      mastery: row(address),
      offers: [{ id: 'offer', item_type: 'reward', template: 'template', cost: '2', enabled: true }],
    },
  })
}

for (const replacement of ['different-address', 'same-address', 'stopped-observer'] as const)
  for (const outcome of ['success', 'failure'] as const)
    test(`Mastery ${outcome} from an old session cannot affect ${replacement}`, async () => {
      const app = create_app()
      const old = Promise.withResolvers<{ mastery: MasteryRow | null }>()
      const current = Promise.withResolvers<{ mastery: MasteryRow | null }>()
      const stop = app.observe(['mastery'])
      const shown: Toast[] = []
      const unsubscribe = toast.subscribe((event) => {
        if (event.type === 'show') shown.push(event.toast)
      })
      login(app, 'A', () => old.promise)
      app.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'kares', count: 3 })
      if (replacement === 'stopped-observer') stop()
      else {
        app.dispatch({ type: 'auth/disconnected' })
        login(app, replacement === 'same-address' ? 'A' : 'B', () => current.promise)
        app.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment: 'kares', count: 3 })
      }
      const before = app.store.getState().mastery
      try {
        if (outcome === 'success') old.resolve({ mastery: row('A', '999') })
        else old.reject(new Error('Old wallet purchase failed'))
        await Bun.sleep(0)
        expect(app.store.getState().mastery).toBe(before)
        expect(app.store.getState().mastery.pending).toBe('redeem:reward')
        expect(shown).toHaveLength(0)
      } finally {
        stop()
        unsubscribe()
      }
    })

for (const outcome of ['success', 'failure'] as const)
  test(`a replaced session ignores a delayed daily-quest ${outcome}`, async () => {
    const app = create_app()
    const old = Promise.withResolvers<{ mastery: MasteryRow | null }>()
    const current = Promise.withResolvers<{ mastery: MasteryRow | null }>()
    const world = content_catalog.worlds[0]!
    const start = (address: string, result: Promise<{ mastery: MasteryRow | null }>) => {
      login(app, address, () => result)
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/characters',
          characters: [
            { id: 'hero', name: 'Hero', level: world.entry_level, custody: 'kiosk', kiosk: 'kiosk', kiosk_cap: 'cap' },
          ] as never,
        },
      })
      app.dispatch({ type: 'mastery/start', world: world.world })
    }
    const stop = app.observe(['mastery'])
    const shown: Toast[] = []
    const unsubscribe = toast.subscribe((event) => {
      if (event.type === 'show') shown.push(event.toast)
    })
    start('A', old.promise)
    app.dispatch({ type: 'auth/disconnected' })
    start('B', current.promise)
    const before = app.store.getState().mastery
    try {
      expect(before.pending).toBe('start')
      if (outcome === 'success') old.resolve({ mastery: row('A', '999') })
      else old.reject(new Error('Old quest failed'))
      await Bun.sleep(0)
      expect(app.store.getState().mastery).toBe(before)
      expect(shown).toHaveLength(0)
    } finally {
      stop()
      unsubscribe()
    }
  })
