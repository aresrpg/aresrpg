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
import { AgentPairingStage, type PairingProvider } from './AgentPairingStage.tsx'
import { agent_guide_url, AgentPrompt } from './AgentHandoff.tsx'

const request_setup: SetupExchange = (wallet, request) =>
  new Promise((resolve, reject) => dispatch_app({ type: 'agent_setup/request', wallet, request, resolve, reject }))

/** A temporary public-key proof, never a durable connection or character custody. */
export const AgentPairing = ({
  copy,
  read_request,
  disabled,
  provider,
  title_id,
  exchange = request_setup,
  children,
  connected,
}: Readonly<{
  copy: AppCopy
  read_request: (nonce: string) => AgentPairingRequest | null
  disabled: boolean
  provider?: PairingProvider
  title_id: string
  exchange?: SetupExchange
  children?: ReactNode
  connected: () => void
}>) => {
  const [state, dispatch] = useReducer(reduce_pairing, EMPTY_PAIRING)
  const wallet = useAppStore((app) => app.session.wallet)
  const candidate = useAppStore((app) => app.session.agent_pairing_candidate)
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
    if (state.status !== 'verified' || !state.identity || candidate?.address !== state.identity.address) return
    // Presentation delay only: verified proof and saved recovery metadata already own success.
    const timer = setTimeout(() => {
      const { session } = read_app_state()
      if (session.wallet === wallet && session.agent_pairing_candidate === candidate) connected()
    }, 1_600)
    return () => clearTimeout(timer)
  }, [state.status, state.identity, candidate, wallet, connected])
  const begin = () => {
    try {
      const request = read_request(crypto.randomUUID())
      dispatch({ type: 'start', public_identifier: request?.zklogin_public_identifier ?? null })
    } catch {
      console.error('Wallet public pairing request is unavailable.')
      dispatch({ type: 'start', public_identifier: null })
    }
  }
  const pending = ['starting', 'waiting'].includes(state.status)
  const failure = {
    storage: text.agent_pair_storage_failed,
    disposable: text.agent_pair_disposable,
    unavailable: text.agent_pair_failed,
  }[state.failure ?? 'unavailable']
  const title = {
    idle: text.agent_choose,
    starting: text.agent_connect_your,
    waiting: text.agent_connect_your,
    failed: text.agent_connect_your,
    verified: text.agent_connected,
  }[state.status]
  const can_connect = ['idle', 'failed'].includes(state.status)
  return (
    <div className="agent-setup-details" data-agent-pairing={state.status}>
      {state.status === 'idle' ? (
        children
      ) : (
        <>
          <h2 id={title_id}>{title}</h2>
          {state.link && (
            <section className="agent-pair-prompt">
              <div className="agent-pair-label">
                <span>{text.agent_setup_request}</span>
                <span className="agent-pair-provider">{provider?.label}</span>
              </div>
              <AgentPrompt
                key={state.link}
                copy={copy}
                request={copy_text(text)('agent_setup_prompt', { url: state.link, guide: agent_guide_url() })}
                hint={text.agent_pair_instructions}
              />
            </section>
          )}
          <AgentPairingStage copy={copy} state={state.status} provider={provider} failure={failure} />
        </>
      )}
      {can_connect && (
        <Button className="agent-connect" tone="primary" disabled={disabled} onClick={begin}>
          {text.agent_pair_connect}
        </Button>
      )}
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
    </div>
  )
}
