// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Bot } from 'lucide-react'
import { Button } from '@aresrpg/ui'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'
import { InventoryTransferGrid } from '../characters/InventoryTransferGrid.tsx'

import type { AgentKioskController, KioskInventory } from './useAgentKiosk.ts'
import { agent_inventory_groups, type TransferToken } from './inventory_transfer.ts'
import { AgentTransferFunding } from './AgentTransferFunding.tsx'
import { AgentCoinTransfer } from './AgentCoinTransfer.tsx'
import { owner_connected } from './owner_state.ts'
import { AgentSetupButton } from './AgentSetup.tsx'
import { AgentKioskIdentity } from './AgentKioskIdentity.tsx'
import { AgentKioskCharacters } from './AgentKioskCharacters.tsx'
import './agent_inventory.css'

export const AgentKioskPanel = ({
  kiosk,
  copy,
  disabled,
  offline,
}: Readonly<{
  kiosk: AgentKioskController
  copy: AppCopy
  disabled: boolean
  offline: boolean
}>) => {
  const [coin, set_coin] = useState<TransferToken | null>(null)
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
      <AgentKioskStatus kiosk={kiosk} copy={copy} offline={offline} />
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
          <AgentKioskCharacters kiosk={kiosk} copy={copy} disabled={busy || state.phase !== 'ready'} />
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

const AgentKioskStatus = ({
  kiosk,
  copy,
  offline,
}: Readonly<{ kiosk: AgentKioskController; copy: AppCopy; offline: boolean }>) => {
  const connected = useAppStore((app) => owner_connected(app.session))
  if (offline) return <p>{copy.ui.agent_inventory_demo}</p>
  if (!kiosk.pairing) return <AgentKioskIdentity copy={copy} />
  const failure =
    kiosk.state.error ||
    kiosk.transaction.error ||
    (kiosk.item_recovery_blocked ? copy.ui.agent_transfer_interrupted : null)
  const retry = kiosk.item_recovery_blocked ? kiosk.retry_items : kiosk.state.error ? kiosk.refresh : kiosk.retry
  return (
    <>
      {kiosk.pairing.signer_mode === 'disposable' && (
        <AgentSetupButton copy={copy} label={copy.ui.agent_connect_your} />
      )}
      {connected && <p role="status">{copy.ui.agent_connected}</p>}
      <p className="agent-transfer-error" role="alert" hidden={!failure}>
        {failure}
      </p>
      {failure && (
        <Button disabled={kiosk.busy || kiosk.state.phase === 'loading'} onClick={retry}>
          {copy.ui.agent_hosted_retry}
        </Button>
      )}
      <p role="status" hidden={kiosk.state.phase !== 'loading'}>
        {copy.loading_universe}
      </p>
    </>
  )
}
