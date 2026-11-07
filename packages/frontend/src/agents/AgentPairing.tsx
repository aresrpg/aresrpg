// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { useEffect, useReducer } from 'react'
import { Button } from '@aresrpg/ui'
import type { AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { remember_agent_identity } from './pairing_storage.ts'
import { AgentSavedPairings } from './AgentSavedPairings.tsx'
import { EMPTY_PAIRING, reduce_pairing } from './pairing_state.ts'
import { run_agent_setup } from './setup_exchange.ts'
import type { SetupExchange } from './setup_requests.ts'
import { AgentTransferPreview } from './AgentTransferPreview.tsx'
import { agent_guide_url, AgentPrompt } from './AgentHandoff.tsx'

const request_setup: SetupExchange = (wallet, request) =>
  new Promise((resolve, reject) => dispatch_app({ type: 'agent_setup/request', wallet, request, resolve, reject }))

const PairedIdentity = ({ identity, copy }: Readonly<{ identity: AgentPairingIdentity | null; copy: AppCopy }>) => {
  if (!identity) return null
  const persistent = identity.signer_mode === 'host-persistent'
  return (
    <div>
      <p role="status">{copy.ui.agent_pair_verified}</p>
      <p>{persistent ? copy.ui.agent_signer_persistent : copy.ui.agent_pair_ephemeral}</p>
      <output className="block break-all" data-paired-address="">
        {identity.address}
      </output>
      <AgentTransferPreview key={identity.address} pairing={identity} copy={copy} />
    </div>
  )
}

/** A temporary public-key proof, never a durable connection or character custody. */
export const AgentPairing = ({
  copy,
  read_request,
  disabled,
  exchange = request_setup,
}: Readonly<{
  copy: AppCopy
  read_request: (nonce: string) => AgentPairingRequest | null
  disabled: boolean
  exchange?: SetupExchange
}>) => {
  const [state, dispatch] = useReducer(reduce_pairing, EMPTY_PAIRING)
  const wallet = useAppStore((app) => app.session.wallet)
  const text = copy.ui
  useEffect(() => dispatch({ type: 'clear' }), [read_request])
  const { public_identifier, attempt } = state
  useEffect(() => {
    if (!public_identifier || !wallet) return
    const controller = new AbortController()
    void run_agent_setup(wallet, public_identifier, attempt, exchange, controller.signal, dispatch)
      .then((identity) => {
        if (controller.signal.aborted) return null
        save_pairing(read_request, identity)
        return identity
      })
      .then(
        (identity) => {
          if (identity && !controller.signal.aborted) dispatch({ type: 'verified', attempt, identity })
        },
        (error) => {
          console.error('Agent pairing could not complete.', error)
          if (!controller.signal.aborted) dispatch({ type: 'failed', attempt })
        }
      )
    return () => controller.abort()
  }, [public_identifier, attempt, wallet, exchange, read_request])
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
      <Button className="agent-connect" tone="primary" disabled={disabled || pending} onClick={begin}>
        {text.agent_pair_connect}
      </Button>
      {state.link && (
        <AgentPrompt
          key={state.link}
          copy={copy}
          request={copy_text(text)('agent_setup_prompt', { url: state.link, guide: agent_guide_url() })}
          hint={text.agent_pair_instructions}
        />
      )}
      <p role="status" hidden={!pending}>
        {text.agent_pair_pending}
      </p>
      {pending && <Button onClick={() => dispatch({ type: 'clear' })}>{text.agent_cancel}</Button>}
      <p role="alert" hidden={state.status !== 'failed'}>
        {text.agent_pair_failed}
      </p>
      <PairedIdentity identity={state.identity} copy={copy} />
      <SavedRecovery
        key={recovery_key(wallet, state.identity)}
        read_request={read_request}
        exclude={paired_address(state.identity)}
        copy={copy}
      />
    </div>
  )
}

const SavedRecovery = ({
  read_request,
  exclude,
  copy,
}: Readonly<{
  read_request: (nonce: string) => AgentPairingRequest | null
  exclude?: string
  copy: AppCopy
}>) => {
  let request: AgentPairingRequest | null
  try {
    request = read_request(crypto.randomUUID())
  } catch (error) {
    console.error('Saved agent recovery identity is unavailable.', error)
    return null
  }
  return request ? <AgentSavedPairings request={request} exclude={exclude} copy={copy} /> : null
}

const save_pairing = (read_request: (nonce: string) => AgentPairingRequest | null, identity: AgentPairingIdentity) => {
  const request = read_request(crypto.randomUUID())
  if (!request) throw new Error('Google identity unavailable')
  remember_agent_identity(browser_auth_storage(), request, identity)
}

const paired_address = (identity: AgentPairingIdentity | null) => identity?.address
const recovery_key = (wallet: Readonly<{ address: string }> | null, identity: AgentPairingIdentity | null) =>
  JSON.stringify([wallet?.address, paired_address(identity)])
