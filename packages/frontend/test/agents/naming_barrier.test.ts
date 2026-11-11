// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import * as store from '../../src/store.ts'
import { begin_setup_name } from '../../src/agents/naming_barrier.ts'

const pairing = { address: 'agent' } as AgentPairingIdentity
const setup = () => {
  const app = store.create_app()
  const wallet = { suins: { managed: true } } as never
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  const read = spyOn(store, 'read_app_state').mockImplementation(app.store.getState)
  const dispatch = spyOn(store, 'dispatch_app').mockImplementation(app.dispatch)
  const subscribe = spyOn(store, 'subscribe_app').mockImplementation(app.store.subscribe)
  const controller = new AbortController()
  return {
    app,
    wallet,
    controller,
    cleanup: () => {
      controller.abort()
      read.mockRestore()
      dispatch.mockRestore()
      subscribe.mockRestore()
    },
  }
}

test('Connect cannot proceed until naming terminates, but naming refusal releases its barrier', async () => {
  const f = setup()
  try {
    const ready = begin_setup_name(f.wallet, f.controller.signal)
    let navigable = false
    const result = ready(pairing).then(() => {
      navigable = true
    })
    const request = f.app.store.getState().suins.request!
    f.app.dispatch({ type: 'suins/loaded', request, snapshot: { default_name: 'aresrpg.sceat.sui', names: [] } })
    await Bun.sleep(0)
    expect(navigable).toBeFalse()
    f.app.dispatch({ type: 'suins/failed', request: f.app.store.getState().suins.request!, error: 'metadata' })
    await result
    expect(navigable).toBeTrue()
    expect(f.app.store.getState().suins.error).toBe('metadata')
  } finally {
    f.cleanup()
  }
})

test('a refused overlapping Apply consumes setup before its proof arrives; no automatic repair follows', async () => {
  const f = setup()
  try {
    const ready = begin_setup_name(f.wallet, f.controller.signal)
    f.app.dispatch({ type: 'suins/name_changed', name: 'sceat.sui' })
    f.app.dispatch({ type: 'suins/use' })
    f.app.dispatch({ type: 'suins/failed', request: f.app.store.getState().suins.request!, error: 'write_failed' })
    const finished = f.app.store.getState().suins
    await ready(pairing)
    expect(f.app.store.getState().suins).toBe(finished)
  } finally {
    f.cleanup()
  }
})
