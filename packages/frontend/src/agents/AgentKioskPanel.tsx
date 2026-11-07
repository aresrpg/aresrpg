// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Bot, RefreshCw } from 'lucide-react'
import { Button } from '@aresrpg/ui'
import type { AgentInventory } from '@aresrpg/sdk/agent-inventory'

import type { AppCopy } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'

import type { AgentKioskController } from './useAgentKiosk.ts'
import { agent_inventory_groups, type TransferToken } from './inventory_transfer.ts'
import { AgentSetupButton } from './AgentSetup.tsx'
import { AgentCoinTransfer } from './AgentCoinTransfer.tsx'
import { AgentTransferReview } from './AgentTransferReview.tsx'
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
  const { snapshot, pairing, state, review } = kiosk
  const busy = disabled || !!review || state.phase === 'loading'
  const refreshable = [!offline, pairing, !busy].every(Boolean)
  const controls_disabled = busy || state.phase !== 'ready'
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
      {snapshot && (
        <>
          <AgentBalances inventory={snapshot.inventory} disabled={controls_disabled} choose={set_coin} />
          <AgentKioskGrid rows={snapshot.inventory.items} copy={copy} disabled={controls_disabled} transfer={drop} />
          <AgentPendingTransfers kiosk={kiosk} copy={copy} disabled={controls_disabled} />
        </>
      )}
      {coin && <AgentCoinTransfer key={coin} token={coin} kiosk={kiosk} copy={copy} close={() => set_coin(null)} />}
      <AgentKioskReview kiosk={kiosk} copy={copy} />
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
        <button type="button" key={token} disabled={disabled} onClick={() => choose(token)}>
          {token.toUpperCase()} <b>{balance === null ? '—' : format_sui(BigInt(balance), 4)}</b>
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
  if (offline) return <p>{copy.ui.agent_inventory_demo}</p>
  if (!kiosk.pairing)
    return (
      <>
        <p>{copy.ui.agent_inventory_connect}</p>
        <AgentSetupButton copy={copy} />
      </>
    )
  return (
    <>
      <p role="alert" hidden={!kiosk.state.error}>
        {kiosk.state.error}
      </p>
      <p role="status" hidden={kiosk.state.phase !== 'loading'}>
        {copy.loading_universe}
      </p>
    </>
  )
}

const AgentKioskReview = ({ kiosk, copy }: Readonly<{ kiosk: AgentKioskController; copy: AppCopy }>) => {
  const { review, wallet, pairing } = kiosk
  if (!review || !wallet) return null
  return (
    <AgentTransferReview
      key={JSON.stringify(review.intent)}
      wallet={wallet}
      actions={review.actions}
      intent={review.intent}
      copy={copy}
      funding_pairing={pairing ?? undefined}
      allow_submit
      close={() => kiosk.set_review(null)}
      on_complete={kiosk.refresh}
    />
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
