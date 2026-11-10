// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import type { AgentInventory } from '@aresrpg/sdk/agent-inventory'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'

import type { AgentKioskController } from './useAgentKiosk.ts'
import { agent_inventory_groups, type TransferToken } from './inventory_transfer.ts'
import { AgentCoinTransfer } from './AgentCoinTransfer.tsx'
import { owner_connected } from './owner_state.ts'
import { AgentRecovery } from './AgentRecovery.tsx'
import { AgentKioskIdentity } from './AgentKioskIdentity.tsx'
import { AgentKioskCharacters } from './AgentKioskCharacters.tsx'
import { AgentKioskGrid } from './AgentKioskGrid.tsx'
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
  const busy = disabled || kiosk.busy || state.phase === 'loading'
  const refreshable = [!offline, pairing, !busy].every(Boolean)
  const controls_disabled = busy || kiosk.blocked || state.phase !== 'ready'
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
        <Button aria-label={copy.ui.agent_asset_refresh} disabled={!refreshable} onClick={kiosk.refresh}>
          <RefreshCw size={13} />
        </Button>
      </header>
      <AgentKioskStatus kiosk={kiosk} copy={copy} offline={offline} />
      <AgentRecovery copy={copy} mode="inventory" offline={offline} />
      {snapshot && (
        <>
          <AgentBalances inventory={snapshot.inventory} disabled={controls_disabled} choose={set_coin} />
          <AgentKioskGrid
            rows={snapshot.inventory.items}
            copy={copy}
            disabled={controls_disabled}
            pending_ids={kiosk.pending_ids}
            transfer={drop}
          />
          <AgentPendingTransfers kiosk={kiosk} copy={copy} disabled={controls_disabled} />
          <AgentKioskCharacters kiosk={kiosk} copy={copy} disabled={controls_disabled} />
          {coin && <AgentCoinTransfer key={coin} token={coin} kiosk={kiosk} copy={copy} close={() => set_coin(null)} />}
        </>
      )}
    </section>
  )
}

const AgentBalances = ({
  inventory,
  disabled,
  choose,
}: Readonly<{ inventory: AgentInventory; disabled: boolean; choose: (token: TransferToken) => void }>) => (
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
          <b>{balance === null ? '—' : format_sui(BigInt(balance), 4)}</b>
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
  return (
    <>
      {connected && <p role="status">{copy.ui.agent_connected}</p>}
      <p className="agent-transfer-error" role="alert" hidden={!(kiosk.state.error || kiosk.transaction?.error)}>
        {kiosk.state.error || kiosk.transaction?.error}
      </p>
      <p role="status" hidden={kiosk.state.phase !== 'loading'}>
        {copy.loading_universe}
      </p>
    </>
  )
}

const AgentPendingTransfers = ({
  kiosk,
  copy,
  disabled,
}: Readonly<{ kiosk: AgentKioskController; copy: AppCopy; disabled: boolean }>) => {
  const { routes } = kiosk
  if (!routes) return null
  return (
    <div className="agent-kiosk__pending">
      {(['deposit', 'withdraw'] as const).map((direction) => {
        const route = routes[direction]
        if (!route.pending.length) return null
        return (
          <div key={direction}>
            <p>
              {copy.ui[direction === 'deposit' ? 'agent_deposit' : 'agent_withdraw']} · {route.pending.length} ·{' '}
              {copy.ui.agent_claim_pending}
            </p>
            <Button disabled={disabled || !route.can_claim} onClick={() => kiosk.incoming(direction, false)}>
              {copy.ui.agent_asset_claim}
            </Button>
            <Button disabled={disabled} onClick={() => kiosk.incoming(direction, true)}>
              {copy.ui.agent_asset_cancel}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
