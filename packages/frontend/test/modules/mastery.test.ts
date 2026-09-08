// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { create_app } from '../../src/store.ts'
import { toast, type Toast } from '../../src/toast.ts'

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
