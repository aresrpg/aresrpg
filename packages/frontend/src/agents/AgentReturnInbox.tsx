// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useReducer } from 'react'
import { Button } from '@aresrpg/ui'
import type { AgentReturnOffer } from '@aresrpg/sdk/agent-returns'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { AgentReturnReview } from './AgentReturnReview.tsx'

type State = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'failed'; offers: readonly AgentReturnOffer[] }>
type Input = Readonly<{ type: 'loading' | 'failed' } | { type: 'ready'; offers: readonly AgentReturnOffer[] }>
const reduce = (_state: State, input: Input): State => ({
  phase: input.type,
  offers: input.type === 'ready' ? input.offers : [],
})
export const AgentReturnInbox = ({
  wallet,
  address,
  copy,
}: Readonly<{
  wallet: AuthSession
  address: string
  copy: AppCopy
}>) => {
  const [state, dispatch] = useReducer(reduce, { phase: 'idle', offers: [] })
  const active = useAppStore((app) => app.session.wallet === wallet)
  const refresh = () => {
    if (!active || state.phase === 'loading') return
    dispatch({ type: 'loading' })
    void wallet.read_agent_returns(address).then(
      (offers) => dispatch({ type: 'ready', offers }),
      () => dispatch({ type: 'failed' })
    )
  }
  if (!active) return null
  return (
    <section className="space-y-2" data-agent-return-inbox="">
      <Button onClick={refresh} disabled={state.phase === 'loading'}>
        {copy.ui.agent_return_check}
      </Button>
      {state.phase === 'failed' && <p role="alert">{copy.ui.agent_return_failed}</p>}
      {state.phase === 'ready' && state.offers.length === 0 && <p>{copy.ui.agent_return_empty}</p>}
      {state.offers.map((offer) => (
        <AgentReturnReview key={JSON.stringify(offer)} wallet={wallet} offer={offer} copy={copy} />
      ))}
    </section>
  )
}
