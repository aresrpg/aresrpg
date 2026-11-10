// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { AgentTransferActions, AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import { complete_agent_handover, AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { read_app_state, dispatch_app } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'
import { toast } from '../toast.ts'
import { send_text } from '../components/SuiTransferResult.tsx'

import { agent_transfer_error, agent_transfer_needs_gas } from './transfer_error.ts'
import { execute_agent_transfer } from './agent_transaction.ts'
import type { TransferPreview } from './inventory_transfer.ts'
import { same_inventory_pairing } from './inventory_state.ts'

type Handover = Pick<Parameters<typeof complete_agent_handover>[0], 'claim' | 'read'>
type State = Readonly<{
  wallet: AuthSession | null
  pairing: AgentPairingIdentity | null
  intent: AgentTransferIntent | null
  phase: 'idle' | 'preparing' | 'success' | 'failed'
  preview?: TransferPreview
  error?: string
  digest?: string
  retryable?: boolean
}>
const idle: State = { wallet: null, pairing: null, intent: null, phase: 'idle' }

/** Pending cells are presentation only. Only the indexed account stream confirms ownership. */
export const useAgentTransaction = (
  wallet: AuthSession | null,
  pairing: AgentPairingIdentity | null,
  complete: () => void,
  copy: AppCopy
) => {
  const mounted = useRef(true)
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data -- This ref retires unsigned work on inventory dismissal.
    mounted.current = true
    return () => {
      // eslint-disable-next-line functional/immutable-data -- Cleanup prevents late preparations from requesting signatures.
      mounted.current = false
    }
  }, [])
  const [state, set_state] = useState<State>(idle)
  const [funding_sender, set_funding_sender] = useState<string | null>(null)
  const transaction = state.wallet === wallet && same_inventory_pairing(state.pairing, pairing) ? state : idle
  const busy = transaction.phase === 'preparing'
  const blocked = transaction.phase === 'failed' && !transaction.retryable
  const execute = (
    actions: AgentTransferActions,
    intent: AgentTransferIntent,
    options: Readonly<{ handover?: Handover; preview?: TransferPreview }> = {}
  ) => {
    if (!wallet || !pairing || busy) return null
    if (blocked && JSON.stringify(transaction.intent) === JSON.stringify(intent)) return null
    const is_current = () => {
      const { session } = read_app_state()
      return mounted.current && session.wallet === wallet && same_inventory_pairing(session.inventory_pairing, pairing)
    }
    const before_sign = () => {
      if (!is_current()) throw new Error('The confirmed wallet or agent changed.')
    }
    const pending = run_direct_transaction(() =>
      options.handover && (intent.kind === 'offer' || intent.kind === 'asset_offer')
        ? complete_agent_handover({ offer: actions, intent, ...options.handover, before_sign })
        : execute_agent_transfer({ actions, intent, is_current })
    )
    if (!pending) return null
    const notification = toast.loading(copy.ui.agent_sending)
    set_state({ wallet, pairing, intent, preview: options.preview, phase: 'preparing' })
    void pending.then(
      ({ digest }) => {
        notification.success(send_text(copy, 'success_title'))
        if (!is_current()) return
        set_state({ wallet, pairing, intent, preview: options.preview, phase: 'success', digest })
        dispatch_app({ type: 'wallet/refresh' })
        complete()
      },
      (error) => {
        const failure = agent_transfer_error(copy, error)
        notification.error(failure)
        if (!is_current()) return
        if (agent_transfer_needs_gas(error))
          set_funding_sender(error instanceof AgentHandoverIncomplete ? options.handover!.claim.sender : actions.sender)
        set_state({
          wallet,
          pairing,
          intent,
          preview: options.preview,
          phase: 'failed',
          error: failure.message,
          retryable: pre_submission_failure(error),
        })
        complete()
      }
    )
    return pending
  }
  const preview = transaction.phase === 'failed' && transaction.retryable ? undefined : transaction.preview
  const pending_ids = new Set(preview?.items.map(({ id }) => id))
  return {
    transaction,
    execute,
    busy,
    blocked,
    pending_ids,
    preview,
    funding_sender,
    dismiss_funding: () => set_funding_sender(null),
  }
}
