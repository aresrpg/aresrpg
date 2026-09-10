// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { close, flush, type ErrorEvent } from '@sentry/react'

import { content_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { init_reporting } from '../../src/reporting.ts'
import { create_app } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'

for (const succeeds of [false, true])
  test(`daily quest assignment reports ${succeeds ? 'success without a Sentry error' : 'a genuine failure'}`, async () => {
    const app = create_app()
    const copy = await load_app_copy('en')
    const world = content_catalog.worlds[0]!
    const reports: ErrorEvent[] = []
    init_reporting({ MODE: 'production', VITE_SENTRY_DSN: 'https://public@example.com/1' }, () => ({
      send: async ([, items]) => {
        for (const [header, payload] of items) if (header.type === 'event') reports.push(payload as ErrorEvent)
        return { statusCode: 200 }
      },
      flush: async () => true,
    }))
    app.dispatch({ type: 'locale/loaded', locale: 'en', copy })
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({
      type: 'auth/connected',
      session: {
        address: '0xowner',
        mastery: {
          start: async () => {
            if (!succeeds) throw new Error('Quest assignment rejected')
            return { mastery: null }
          },
        },
      } as never,
    })
    app.dispatch({
      type: 'server/packet',
      packet: {
        type: 'packet/characters',
        characters: [
          { id: 'hero', name: 'Hero', level: world.entry_level, custody: 'kiosk', kiosk: '0xk', kiosk_cap: '0xc' },
        ] as never,
      },
    })
    const shown: Toast[] = []
    const unsubscribe = toast.subscribe((event) => {
      if (event.type === 'show') shown.push(event.toast)
    })
    const stop = app.observe(['mastery'])
    try {
      app.dispatch({ type: 'mastery/start', world: world.world })
      await Bun.sleep(0)
      await flush(2_000)
      expect(shown).toHaveLength(1)
      expect(shown[0]).toMatchObject({
        message: succeeds ? copy.mastery_page.quest_started : 'Quest assignment rejected',
        type: succeeds ? 'success' : 'error',
      })
      expect(reports).toHaveLength(succeeds ? 0 : 1)
    } finally {
      stop()
      unsubscribe()
      await close()
    }
  })

for (const payment of ['mastery', 'kares'] as const)
  for (const succeeds of [false, true])
    test(`Mastery ${payment} purchase reports ${succeeds ? 'success' : 'error'} with the matching toast tone`, async () => {
      const app = create_app()
      const copy = await load_app_copy('en')
      app.dispatch({ type: 'locale/loaded', locale: 'en', copy })
      app.dispatch({ type: 'auth/connecting' })
      app.dispatch({
        type: 'auth/connected',
        session: {
          address: '0xowner',
          mastery: {
            redeem: async () => {
              if (!succeeds) throw new Error('Purchase rejected')
              return { mastery: null }
            },
          },
        } as never,
      })
      app.dispatch({
        type: 'server/packet',
        packet: {
          type: 'packet/mastery',
          mastery: null,
          offers: [{ id: 'offer', template: 'template', item_type: 'reward', cost: '2', enabled: true }],
        },
      })
      const shown: Toast[] = []
      const unsubscribe = toast.subscribe((event) => {
        if (event.type === 'show') shown.push(event.toast)
      })
      const stop = app.observe(['mastery'])
      try {
        app.dispatch({ type: 'mastery/redeem', item_type: 'reward', payment })
        await Bun.sleep(0)
        expect(shown).toHaveLength(1)
        expect(shown[0]).toMatchObject({
          message: succeeds ? copy.mastery_page.offer_purchased : 'Purchase rejected',
          type: succeeds ? 'success' : 'error',
        })
      } finally {
        stop()
        unsubscribe()
      }
    })
