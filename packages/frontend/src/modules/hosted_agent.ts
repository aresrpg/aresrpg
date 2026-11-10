// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AuthSession } from '../auth.ts'
import type { AppModule } from '../store.ts'
import { env } from '../env.ts'
import { cancel_hosted_session, create_hosted_client, refresh_hosted_owner } from '../agents/hosted_client.ts'
import { agent_identity_storage_key } from '../agents/pairing_storage.ts'

// Visible owner UI revalidates authorization on the same cadence as wallet balance reads.
const REFRESH_MS = 5_000
export default {
  name: 'hosted_agent',
  reduce: undefined,
  observe: ({ events, dispatch, get_state, signal }) => {
    if (!env.bot_service_url || typeof window === 'undefined') return
    let context: { wallet: AuthSession; authorization_id: string | null; controller: AbortController | null } | null =
      null
    const cancel = () => {
      const previous = context
      previous?.controller?.abort()
      if (previous?.authorization_id)
        void cancel_hosted_session(env.bot_service_url, previous.authorization_id).catch(console.warn)
      context = null
    }
    const eligible = () =>
      env.bot_service_url &&
      !new URLSearchParams(location.search).has('authorization_id') &&
      get_state().session.wallet?.identity === 'zklogin'
    const refresh = () => {
      if (
        eligible() &&
        document.visibilityState === 'visible' &&
        get_state().session.agent_connection.phase !== 'failed'
      )
        dispatch({ type: 'agent/connection_refresh' })
    }
    const run = async () => {
      const { wallet, agent_connection } = get_state().session
      if (!wallet || !eligible()) return
      if (context?.wallet !== wallet) {
        cancel()
        context = { wallet, authorization_id: null, controller: null }
      }
      const active = context!
      active.controller?.abort()
      const controller = new AbortController()
      // eslint-disable-next-line functional/immutable-data -- This object owns the cancellable network lifetime, not application state.
      active.controller = controller
      try {
        const result = await refresh_hosted_owner(
          create_hosted_client(env.bot_service_url, controller.signal, { get_state, dispatch }),
          wallet,
          active.authorization_id,
          (id) => {
            // eslint-disable-next-line functional/immutable-data -- Retain the public request handle solely for cancellation and authenticated reuse.
            active.authorization_id = id
          },
          agent_connection.response
        )
        controller.signal.throwIfAborted()
        dispatch({ type: 'agent/connection_result', wallet, generation: agent_connection.generation, ...result })
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('Owner agent connection could not be verified.', error)
        dispatch({
          type: 'agent/connection_result',
          wallet,
          generation: agent_connection.generation,
          response: null,
          pairing: null,
        })
      }
    }
    events.on('STATE_UPDATED', (state, previous) => {
      if (state.session.wallet !== previous.session.wallet) {
        cancel()
        refresh()
      }
      const { agent_connection: next } = state.session
      if (next.generation !== previous.session.agent_connection.generation && next.phase === 'checking') void run()
    })
    events.on('agent/connection_cancel', cancel)
    const stored = (event: Readonly<StorageEvent>) => {
      const { wallet } = get_state().session
      if (wallet && event.key === agent_identity_storage_key(wallet.address)) refresh()
    }
    window.addEventListener('storage', stored)
    window.addEventListener('focus', refresh)
    const timer = setInterval(() => {
      if (['idle', 'ready'].includes(get_state().session.agent_connection.phase)) refresh()
    }, REFRESH_MS)
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer)
        window.removeEventListener('storage', stored)
        window.removeEventListener('focus', refresh)
        cancel()
      },
      { once: true }
    )
    refresh()
  },
} satisfies AppModule
