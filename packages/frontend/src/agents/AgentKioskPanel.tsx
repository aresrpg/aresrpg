// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Bot } from 'lucide-react'
import { Button, SuiLogo } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { InventoryTransferGrid } from '../characters/InventoryTransferGrid.tsx'

import { AgentKioskStatus } from './AgentKioskStatus.tsx'
import type { AgentKioskController, KioskInventory } from './useAgentKiosk.ts'
import { agent_inventory_groups, type TransferToken } from './inventory_transfer.ts'
import { AgentTransferFunding } from './AgentTransferFunding.tsx'
import { AgentCoinTransfer } from './AgentCoinTransfer.tsx'
import { owner_connected } from './owner_state.ts'
import './agent_inventory.css'

export const AgentKioskPanel = ({
  kiosk,
  copy,
  disabled,
}: Readonly<{
  kiosk: AgentKioskController
  copy: AppCopy
  disabled: boolean
}>) => {
  const [coin, set_coin] = useState<TransferToken | null>(null)
  const connected = useAppStore((app) => owner_connected(app.session))
  const { snapshot, pairing, state } = kiosk
  const busy = [disabled, kiosk.busy, state.phase === 'loading'].some(Boolean)
  const controls_disabled = [busy, kiosk.blocked, state.phase !== 'ready'].some(Boolean)
  const drop = (ids: readonly string[], point: Readonly<{ x: number; y: number }>): boolean => {
    if (!document.elementFromPoint(point.x, point.y)?.closest('[data-inventory-owner="player"]')) return false
    kiosk.offer(ids, 'withdraw')
    return true
  }
  return (
    <section className="agent-kiosk" data-inventory-owner="agent" aria-label={copy.ui.agent_kiosk}>
      <header className="agent-kiosk__header">
        <Bot size={18} />
        <strong>{copy.ui.agent_label}</strong>
        <span className="agent-kiosk__badge">{copy.ui.agent_kiosk_badge}</span>
        <span>{snapshot ? agent_inventory_groups(snapshot.inventory.items).length : '—'}</span>
      </header>
      {connected && kiosk.pairing && <p role="status">{copy.ui.agent_connected}</p>}
      <AgentKioskStatus kiosk={kiosk} copy={copy} />
      {snapshot && (
        <>
          <AgentBalances inventory={snapshot.inventory} disabled={controls_disabled} choose={set_coin} />
          <InventoryTransferGrid
            rows={snapshot.inventory.items}
            incoming={kiosk.agent_pending}
            copy={copy}
            disabled={controls_disabled}
            pending_ids={kiosk.pending_ids}
            transfer={drop}
          />
          {coin && <AgentCoinTransfer key={coin} token={coin} kiosk={kiosk} copy={copy} close={() => set_coin(null)} />}
        </>
      )}
      <AgentTransferFunding
        wallet={kiosk.wallet}
        sender={kiosk.funding_sender}
        pairing={pairing}
        copy={copy}
        close={kiosk.dismiss_funding}
      />
    </section>
  )
}

const AgentBalances = ({
  inventory,
  disabled,
  choose,
}: Readonly<{ inventory: KioskInventory; disabled: boolean; choose: (token: TransferToken) => void }>) => (
  <div className="agent-kiosk__balances">
    {(['sui', 'kares'] as const).map((token) => {
      const balance = inventory[`${token}_mist`]
      return (
        <button
          type="button"
          key={token}
          aria-label={token.toUpperCase()}
          disabled={disabled}
          onClick={() => choose(token)}
        >
          <span className={token === 'sui' ? 'agent-sui-mark' : ''}>
            {token === 'sui' ? <SuiLogo size={18} /> : <KaresLogo size={18} />}
          </span>
          <b>{balance === null ? '—' : format_sui(BigInt(balance), token === 'sui' ? 2 : 4)}</b>
        </button>
      )
    })}
  </div>
)
