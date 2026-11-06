// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useReducer } from 'react'
import { Button } from '@aresrpg/ui'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import type { AgentRecall } from '@aresrpg/sdk/agent-recall'

import type { AuthSession } from '../auth.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { readable_transaction_error } from '../transaction_guard.ts'
import { useAppStore } from '../store.ts'

import { AgentInventoryPanel } from './AgentInventoryPanel.tsx'
import { AgentTransferReview } from './AgentTransferReview.tsx'

type State = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  recall?: AgentRecall
  error?: string
  selected: string
}>
type Input = Readonly<
  | { type: 'loading' }
  | { type: 'ready'; recall: AgentRecall }
  | { type: 'failed'; error: string }
  | { type: 'select'; selected: string }
>
const reduce = (state: State, input: Input): State => {
  switch (input.type) {
    case 'loading':
      return { phase: 'loading', selected: '' }
    case 'ready':
      return { phase: 'ready', recall: input.recall, selected: '' }
    case 'failed':
      return { phase: 'failed', error: input.error, selected: '' }
    case 'select':
      return { ...state, selected: input.selected }
  }
}
export const AgentRecallPanel = ({
  wallet,
  pairing,
  copy,
}: Readonly<{
  wallet: AuthSession
  pairing: AgentPairingIdentity
  copy: AppCopy
}>) => {
  const [state, dispatch] = useReducer(reduce, { phase: 'idle', selected: '' })
  const active = useAppStore((app) => app.session.wallet === wallet)
  const read = () => {
    if (!active || state.phase === 'loading') return
    dispatch({ type: 'loading' })
    void wallet.read_agent_recall(pairing).then(
      (recall) => dispatch({ type: 'ready', recall }),
      (error) => dispatch({ type: 'failed', error: readable_transaction_error(error) })
    )
  }
  const character = state.recall?.characters.find((row) => row.character_id === state.selected)
  if (!active) return null
  return (
    <section className="space-y-2 break-all" data-agent-recall="">
      <Button onClick={read} disabled={state.phase === 'loading'}>
        {copy.ui.agent_recall}
      </Button>
      <p>{copy.ui.agent_recall_steps}</p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.recall && (
        <label>
          {copy.ui.agent_transfer_character}
          <select
            className="block w-full bg-black text-white"
            value={state.selected}
            onChange={(event) => dispatch({ type: 'select', selected: event.target.value })}
          >
            <option value="">—</option>
            {state.recall.characters.map((row) => (
              <option key={row.character_id} value={row.character_id}>
                {row.character_id}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.recall?.pending.map((offer) => (
        <section key={offer.purchase_cap}>
          <p>{copy.ui.agent_cancel_handover}</p>
          <AgentTransferReview
            wallet={wallet}
            actions={state.recall!.transfer}
            funding_pairing={pairing}
            copy={copy}
            allow_submit
            intent={{
              kind: 'cancel',
              seller_kiosk: offer.seller_kiosk,
              purchase_cap: offer.purchase_cap,
              agent_address: offer.agent_address,
              equipment: offer.equipment,
            }}
          />
        </section>
      ))}
      {state.recall && (
        <AgentInventoryPanel
          key={JSON.stringify([pairing.address, state.recall])}
          recall={state.recall}
          pairing={pairing}
          wallet={wallet}
          copy={copy}
        />
      )}
      {character && (
        <AgentTransferReview
          key={JSON.stringify([pairing.address, character, state.recall])}
          wallet={wallet}
          actions={state.recall!.transfer}
          funding_pairing={pairing}
          copy={copy}
          allow_submit
          intent={{
            kind: 'offer',
            character_id: character.character_id,
            kiosk: character.kiosk,
            recipient: wallet.address,
            unequip: character.unequip,
          }}
        />
      )}
    </section>
  )
}
