// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { AgentTransferActions, AgentTransferIntent } from '@aresrpg/sdk/agent-transfer-actions'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'

import type { AuthSession } from '../auth.ts'
import { read_app_state } from '../store.ts'
import { readable_transaction_error, run_direct_transaction } from '../transaction_guard.ts'

import { execute_agent_transfer } from './agent_transaction.ts'

type State = Readonly<{
  wallet: AuthSession | null
  pairing: AgentPairingIdentity | null
  intent: AgentTransferIntent | null
  phase: 'idle' | 'preparing' | 'signing' | 'success' | 'failed'
  error?: string
  digest?: string
  retryable?: boolean
}>

const idle: State = { wallet: null, pairing: null, intent: null, phase: 'idle' }

/** Local presentation for one gesture. The SDK owns signing, receipts and transaction recovery. */
export const useAgentTransaction = (
  wallet: AuthSession | null,
  pairing: AgentPairingIdentity | null,
  complete: () => void
) => {
  const mounted = useRef(true)
  useEffect(() => {
    // eslint-disable-next-line functional/immutable-data -- This ref retires unsigned work on inventory dismissal.
    mounted.current = true
    return () => {
      // eslint-disable-next-line functional/immutable-data -- Cleanup prevents a late preparation from requesting a signature.
      mounted.current = false
    }
  }, [])
  const [state, set_state] = useState<State>(idle)
  const transaction = [state.wallet === wallet, state.pairing === pairing].every(Boolean) ? state : idle
  const busy = ['preparing', 'signing'].includes(transaction.phase)
  const blocked = [transaction.phase === 'failed', !transaction.retryable].every(Boolean)
  const execute = (actions: AgentTransferActions, intent: AgentTransferIntent) => {
    if (!wallet || !pairing || [busy, blocked].some(Boolean)) return null
    const is_current = () => {
      const { session } = read_app_state()
      return [mounted.current, session.wallet === wallet, session.inventory_pairing === pairing].every(Boolean)
    }
    const pending = run_direct_transaction(() =>
      execute_agent_transfer({
        actions,
        intent,
        is_current,
        prepared: () => set_state({ wallet, pairing, intent, phase: 'signing' }),
      })
    )
    if (!pending) return null
    set_state({ wallet, pairing, intent, phase: 'preparing' })
    void pending.then(
      ({ digest }) => {
        if (!is_current()) return
        set_state({ wallet, pairing, intent, phase: 'success', digest })
        complete()
      },
      (error) => {
        if (is_current())
          set_state({
            wallet,
            pairing,
            intent,
            phase: 'failed',
            error: readable_transaction_error(error),
            retryable: pre_submission_failure(error),
          })
      }
    )
    return pending
  }
  const pending_ids = new Set(
    busy && transaction.intent?.kind === 'asset_offer' ? transaction.intent.items.map(({ item_id }) => item_id) : []
  )
  return { transaction, execute, busy, blocked, pending_ids }
}
