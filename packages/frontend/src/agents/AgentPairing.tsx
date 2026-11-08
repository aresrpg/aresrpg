// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { Button } from '@aresrpg/ui'
import type { AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'

import { complete_agent_pairing } from './pairing_storage.ts'
import { EMPTY_PAIRING, reduce_pairing } from './pairing_state.ts'
import { run_agent_setup } from './setup_exchange.ts'
import type { SetupExchange } from './setup_requests.ts'
import { agent_guide_url, AgentPrompt } from './AgentHandoff.tsx'

const request_setup: SetupExchange = (wallet, request) =>
  new Promise((resolve, reject) => dispatch_app({ type: 'agent_setup/request', wallet, request, resolve, reject }))

/** A temporary public-key proof, never a durable connection or character custody. */
export const AgentPairing = ({
  copy,
  read_request,
  disabled,
  exchange = request_setup,
  children,
  connected,
}: Readonly<{
  copy: AppCopy
  read_request: (nonce: string) => AgentPairingRequest | null
  disabled: boolean
  exchange?: SetupExchange
  children?: ReactNode
  connected: () => void
}>) => {
  const [state, dispatch] = useReducer(reduce_pairing, EMPTY_PAIRING)
  const wallet = useAppStore((app) => app.session.wallet)
  const active = useRef<AbortController | null>(null)
  const text = copy.ui
  useEffect(() => dispatch({ type: 'clear' }), [read_request])
  const { public_identifier, attempt } = state
  useEffect(() => {
    if (!public_identifier || !wallet) return
    const controller = new AbortController()
    // eslint-disable-next-line functional/immutable-data -- Cancel retires the current setup synchronously.
    active.current = controller
    void run_agent_setup(wallet, public_identifier, attempt, exchange, controller.signal, dispatch)
      .then((identity) => {
        if (controller.signal.aborted || read_app_state().session.wallet !== wallet) return null
        const failure = complete_agent_pairing(browser_auth_storage(), read_request(crypto.randomUUID()), identity)
        if (failure) {
          dispatch({ type: 'failed', attempt, failure })
          return null
        }
        return identity
      })
      .then(
        (identity) => {
          if (!identity || controller.signal.aborted || read_app_state().session.wallet !== wallet) return
          dispatch_app({ type: 'agent/pairing_verified', wallet, pairing: identity })
          dispatch({ type: 'verified', attempt, identity })
        },
        (error) => {
          console.error('Agent pairing could not complete.', error)
          if (!controller.signal.aborted) dispatch({ type: 'failed', attempt })
        }
      )
    return () => controller.abort()
  }, [public_identifier, attempt, wallet, exchange, read_request])
  useEffect(() => {
    if (state.status !== 'verified') return
    if (read_app_state().session.agent_pairing_candidate?.address === state.identity?.address) connected()
  }, [state.status, state.identity, connected])
  const begin = () => {
    try {
      const request = read_request(crypto.randomUUID())
      dispatch({ type: 'start', public_identifier: request?.zklogin_public_identifier ?? null })
    } catch {
      console.error('Wallet public pairing request is unavailable.')
      dispatch({ type: 'start', public_identifier: null })
    }
  }
  const pending = state.status === 'starting' || state.status === 'waiting'
  return (
    <div className="agent-setup-details" data-agent-pairing="">
      {['idle', 'failed'].includes(state.status) && (
        <>
          {children}
          <Button className="agent-connect" tone="primary" disabled={disabled} onClick={begin}>
            {text.agent_pair_connect}
          </Button>
        </>
      )}
      {state.link && (
        <AgentPrompt
          key={state.link}
          copy={copy}
          request={copy_text(text)('agent_setup_prompt', { url: state.link, guide: agent_guide_url() })}
          hint={text.agent_pair_instructions}
        />
      )}
      <p className="agent-waiting" role="status" hidden={!pending}>
        <span className="agent-waiting-dot" aria-hidden="true" />
        {text.agent_pair_pending}
      </p>
      {pending && (
        <Button
          className="agent-connect"
          onClick={() => {
            active.current?.abort()
            dispatch({ type: 'clear' })
          }}
        >
          {text.agent_cancel}
        </Button>
      )}
      <p role="alert" hidden={state.status !== 'failed'}>
        {state.failure === 'storage'
          ? text.agent_pair_storage_failed
          : state.failure === 'disposable'
            ? text.agent_pair_disposable
            : text.agent_pair_failed}
      </p>
    </div>
  )
}
