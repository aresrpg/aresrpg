// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useEffectEvent, useReducer, useRef } from 'react'
import type { HostedBotDescriptor } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { read_app_state, dispatch_app } from '../store.ts'

import { begin_setup_name } from './naming_barrier.ts'
import {
  empty_hosted,
  hosted_pending,
  reduce_hosted,
  hosted_failure,
  request_inherited,
  type HostedStep,
} from './hosted_state.ts'
import { setup_hosted, authorize_hosted, create_hosted_client, cancel_hosted_session } from './hosted_client.ts'

/** An approved request returns through the redirect its client registered: the browser leaves for it. */
const leave = (redirect: string): void => window.location.assign(redirect)

/**
 * `arrive` receives the redirect of an approved request. The browser leaves for it unless the caller
 * is itself the page that redirect names and takes it in place.
 */
export const useHostedConnect = (
  wallet: AuthSession | null,
  origin: string,
  requested_id: string | null,
  arrive: (redirect: string) => void = leave
) => {
  const [state, dispatch] = useReducer(reduce_hosted<HostedBotDescriptor>, undefined, empty_hosted<HostedBotDescriptor>)
  const eligible = [wallet?.identity === 'zklogin', !!origin].every(Boolean)
  const lifetime = useRef({ authorization_id: requested_id, completed: false, wallet })
  useEffect(() => {
    const context = { authorization_id: requested_id, completed: false, wallet }
    // eslint-disable-next-line functional/immutable-data -- This ref owns one mounted network lifetime, never app state.
    lifetime.current = context
    dispatch({
      type: 'reset',
      session: wallet,
      account: wallet?.address ?? null,
      requested: requested_id !== null && eligible,
    })
    return () =>
      queueMicrotask(() => {
        if (lifetime.current !== context && request_inherited(wallet, lifetime.current.wallet)) return
        if (!origin || !context.authorization_id || context.completed) return
        void cancel_hosted_session(origin, context.authorization_id).catch((error) =>
          console.warn('Hosted authorization cancellation failed; expiry still applies.', error)
        )
      })
  }, [wallet, origin, requested_id, eligible])
  /** The operation of the phase that just began, over the state of the render that began it. */
  const operate = useEffectEvent((owner: AuthSession, generation: number, signal: Readonly<AbortSignal>) => {
    const client = create_hosted_client(origin, signal, { get_state: read_app_state, dispatch: dispatch_app })
    const context = lifetime.current
    const report = (step: HostedStep) => dispatch({ type: 'result', generation, values: { step } })
    const selected_bot = () => {
      const bot = state.bots.find((row) => row.id === state.selected)
      if (!bot) throw new Error('Select an owned bot')
      return bot
    }
    const operations = {
      authenticating: async () => {
        const naming = begin_setup_name(owner, signal)
        const { pairing, ...result } = await setup_hosted(
          client,
          owner,
          requested_id,
          (id) => {
            // eslint-disable-next-line functional/immutable-data -- Retain only the public cancellation handle at the lifecycle edge.
            context.authorization_id = id
          },
          context.authorization_id,
          report
        )
        // Only an account with a managed name waits here; any other has no naming step.
        if (owner.suins.managed) report('naming')
        await naming(pairing)
        signal.throwIfAborted()
        dispatch({ type: 'result', generation, values: { ...result, phase: 'ready' } })
      },
      authorizing: async () => {
        const bot = selected_bot()
        if (!state.authorization_id || !state.consent || state.verified !== bot.id)
          throw new Error('Verified consent required')
        const redirect = await authorize_hosted(client, owner, state.authorization_id, bot, state.consent)
        signal.throwIfAborted()
        // eslint-disable-next-line functional/immutable-data -- Completed OAuth must not be cancelled when navigation disposes the modal.
        context.completed = true
        dispatch({ type: 'result', generation, values: { phase: 'complete' } })
        arrive(redirect)
      },
    }
    void operations[state.phase as keyof typeof operations]().catch((error) => {
      if (signal.aborted) return
      console.error('Hosted agent connection failed.', error)
      dispatch({
        type: 'result',
        generation,
        values: { phase: 'failed', failure: hosted_failure(error, requested_id) },
      })
    })
  })
  const { session, phase, generation } = state
  // Only a new phase, generation or account begins an operation. A step that the operation in flight
  // reports changes the state too, and must never abort and restart it: that would sign twice.
  useEffect(() => {
    if (!wallet || session !== wallet || !origin || !hosted_pending(phase)) return
    const controller = new AbortController()
    operate(wallet, generation, controller.signal)
    return () => controller.abort()
  }, [wallet, origin, session, phase, generation])
  return { state, dispatch, eligible }
}
