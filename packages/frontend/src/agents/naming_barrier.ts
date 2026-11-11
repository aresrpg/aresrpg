// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { dispatch_app, read_app_state, subscribe_app } from '../store.ts'

/** Reserve the intent before setup: an overlapping Apply consumes it even if proof arrives later. */
export const begin_setup_name = (wallet: AuthSession, signal: Readonly<AbortSignal>) => {
  if (!wallet.suins.managed || signal.aborted) return async (_pairing: AgentPairingIdentity): Promise<void> => {}
  const token = crypto.randomUUID()
  let settled = false
  const completion = Promise.withResolvers<void>()
  const finish = () => {
    settled = true
    unsubscribe()
    signal.removeEventListener('abort', cancelled)
    completion.resolve()
  }
  const cancelled = () => {
    dispatch_app({ type: 'suins/cancel_setup', token })
    finish()
  }
  const unsubscribe = subscribe_app((state) => {
    if (state.session.wallet !== wallet || state.suins.completed.includes(token)) finish()
  })
  signal.addEventListener('abort', cancelled, { once: true })
  if (read_app_state().session.wallet !== wallet) finish()
  else dispatch_app({ type: 'suins/setup_started', token })
  return (pairing: AgentPairingIdentity): Promise<void> => {
    if (!settled) dispatch_app({ type: 'suins/setup', pairing, token })
    return completion.promise
  }
}
