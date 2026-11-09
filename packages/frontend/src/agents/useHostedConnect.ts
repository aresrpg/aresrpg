// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer, useRef } from 'react'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'

import { empty_hosted, hosted_pending, reduce_hosted } from './hosted_state.ts'
import {
  authenticate_hosted,
  authorize_hosted,
  create_hosted_client,
  provision_hosted,
  verify_hosted_bot,
} from './hosted_client.ts'

export const useHostedConnect = (wallet: AuthSession | null, origin: string, requested_id: string | null) => {
  const [state, dispatch] = useReducer(reduce_hosted<HostedBotDescriptor>, undefined, empty_hosted<HostedBotDescriptor>)
  const lifetime = useRef({ authorization_id: requested_id, completed: false, wallet })
  useEffect(() => {
    const context = { authorization_id: requested_id, completed: false, wallet }
    // eslint-disable-next-line functional/immutable-data -- This ref owns one mounted network lifetime, never app state.
    lifetime.current = context
    dispatch({ type: 'reset', session: wallet })
    return () =>
      queueMicrotask(() => {
        if (lifetime.current !== context && lifetime.current.wallet === wallet) return
        if (!origin || !context.authorization_id || context.completed) return
        void fetch(new URL('/connect/cancel', origin), {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ authorization_id: context.authorization_id }),
        })
          .then((response) => {
            if (!response.ok) console.warn('Hosted authorization cancellation was refused.')
          })
          .catch((error) => console.warn('Hosted authorization cancellation failed; expiry still applies.', error))
      })
  }, [wallet, origin, requested_id])
  useEffect(() => {
    if (!wallet || state.session !== wallet || !origin || !hosted_pending(state.phase)) return
    const controller = new AbortController()
    const client = create_hosted_client(origin, controller.signal)
    const { generation } = state
    const context = lifetime.current
    const session_id = () => {
      if (!state.authorization_id) throw new Error('Hosted authentication required')
      return state.authorization_id
    }
    const selected_bot = () => {
      const bot = state.bots.find((row) => row.id === state.selected)
      if (!bot) throw new Error('Select an owned bot')
      return bot
    }
    const operations = {
      authenticating: async () => {
        const result = await authenticate_hosted(
          client,
          wallet,
          requested_id,
          (id) => {
            // eslint-disable-next-line functional/immutable-data -- Retain only the public cancellation handle at the lifecycle edge.
            context.authorization_id = id
          },
          context.authorization_id
        )
        dispatch({ type: 'result', generation, values: { ...result, phase: 'ready' } })
      },
      creating: async () => {
        const bot = await provision_hosted(client, session_id())
        dispatch({
          type: 'result',
          generation,
          values: { phase: 'ready', bots: [...state.bots.filter((row) => row.id !== bot.id), bot] },
        })
      },
      verifying: async () => {
        const bot = selected_bot()
        await verify_hosted_bot(client, wallet, session_id(), bot)
        dispatch({ type: 'result', generation, values: { phase: 'ready', verified: bot.id } })
      },
      authorizing: async () => {
        const bot = selected_bot()
        if (!state.consent || state.verified !== bot.id) throw new Error('Verified consent required')
        const redirect = await authorize_hosted(client, wallet, session_id(), bot, state.consent)
        controller.signal.throwIfAborted()
        // eslint-disable-next-line functional/immutable-data -- Completed OAuth must not be cancelled when navigation disposes the modal.
        context.completed = true
        dispatch({ type: 'result', generation, values: { phase: 'complete' } })
        window.location.assign(redirect)
      },
    }
    void operations[state.phase as keyof typeof operations]().catch((error) => {
      if (controller.signal.aborted) return
      console.error('Hosted agent connection failed.', error)
      dispatch({ type: 'result', generation, values: { phase: 'failed' } })
    })
    return () => controller.abort()
  }, [wallet, origin, requested_id, state])
  return { state, dispatch }
}
