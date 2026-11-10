// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AppCopy } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { agent_tab_source } from '../agents/character_tabs.ts'
import { watch_agent_character } from '../agents/watch_character.ts'
import { read_character_recall } from '../agents/character_recall.ts'
import { useAgentTransaction } from '../agents/useAgentTransaction.ts'
import { agent_transfer_error } from '../agents/transfer_error.ts'
import { AgentTransferFunding } from '../agents/AgentTransferFunding.tsx'

import { CharacterTabs } from './CharacterTabs.tsx'

/** Live custody augments display only; demo/adventure tabs continue using their own supplied roster. */
export const PlayerCharacterTabs = ({
  copy,
  create_character,
}: Readonly<{
  copy: AppCopy
  create_character: (() => void) | null
}>) => {
  const session = useAppStore((state) => state.session)
  const agent = agent_tab_source(session)
  const refresh = () => dispatch_app({ type: 'agent/inventory_refresh' })
  const transfer = useAgentTransaction(
    session.wallet,
    agent.pairing,
    refresh,
    copy,
    (current) => agent_tab_source(current).pairing
  )
  const recall = (id: string) => {
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
  return (
    <>
      <CharacterTabs
        characters={session.characters}
        agent_characters={agent.characters}
        select_agent={(id) => watch_agent_character(id, copy)}
        recall_agent={recall}
        agent_busy={transfer.busy || session.agent_connection.phase === 'returning'}
        copy={copy}
        create_character={create_character}
        selected_character_id={session.selected_character_id}
        select_character={(character_id) => dispatch_app({ type: 'character/select', character_id })}
      />
      <AgentTransferFunding
        wallet={session.wallet}
        pairing={agent.pairing}
        sender={transfer.funding_sender}
        close={transfer.dismiss_funding}
        copy={copy}
      />
    </>
  )
}
