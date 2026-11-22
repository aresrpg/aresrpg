// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

import { AgentTransferFunding } from './AgentTransferFunding.tsx'
import { read_character_recall } from './character_recall.ts'
import { agent_tab_source } from './character_tabs.ts'
import { agent_transfer_error } from './transfer_error.ts'
import { useAgentTransaction } from './useAgentTransaction.ts'

const refresh = (): void => dispatch_app({ type: 'agent/inventory_refresh' })

/**
 * A hero of the agent account comes back to the player's own account. One gesture for every surface
 * that shows such a hero: the game's character tabs and the web page's Home. `funding` is the dialog
 * that opens when the agent wallet cannot pay the network fee; the caller renders it once.
 */
export const useCharacterRecall = (copy: AppCopy) => {
  const session = useAppStore((state) => state.session)
  const agent = agent_tab_source(session)
  const transfer = useAgentTransaction(
    session.wallet,
    agent.pairing,
    refresh,
    copy,
    (current) => agent_tab_source(current).pairing
  )
  const recall = (id: string): void => {
    const { wallet } = session
    const { pairing } = agent
    const character = agent.characters.find((row) => row.id === id)
    if (!wallet || !pairing || character?.custody !== 'kiosk') return
    if (read_app_state().session.agent_connection.phase === 'returning') return
    void read_character_recall(wallet, pairing, character)
      .then((plan) => {
        if (read_app_state().session.wallet !== wallet) return
        void transfer.execute(plan.actions, plan.intent, { handover: plan.handover })
      })
      .catch((error) => toast.add(agent_transfer_error(copy, error)))
  }
  return {
    agent,
    recall,
    busy: transfer.busy || session.agent_connection.phase === 'returning',
    funding: (
      <AgentTransferFunding
        wallet={session.wallet}
        pairing={agent.pairing}
        sender={transfer.funding_sender}
        close={transfer.dismiss_funding}
        copy={copy}
      />
    ),
  }
}
