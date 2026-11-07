// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'
import { useAppStore } from '../store.ts'
import { readable_transaction_error } from '../transaction_guard.ts'
import { SendModalShell } from '../components/SendModalShell.tsx'

import type { AgentKioskController } from './useAgentKiosk.ts'
import {
  coin_transfer_intent,
  parse_asset_amount,
  type TransferDirection,
  type TransferToken,
} from './inventory_transfer.ts'

const token_balance = (value: string | null): bigint | null => (value === null ? null : BigInt(value))

export const AgentCoinTransfer = ({
  token,
  kiosk,
  copy,
  close,
}: Readonly<{
  token: TransferToken
  kiosk: AgentKioskController
  copy: AppCopy
  close: () => void
}>) => {
  const [direction, set_direction] = useState<TransferDirection>('withdraw')
  const [amount, set_amount] = useState('')
  const [reserve, set_reserve] = useState(format_sui(GAS_BUDGET_MIST, 9))
  const [estimating, set_estimating] = useState(false)
  const [error, set_error] = useState('')
  const player_sui = useAppStore((app) => app.session.sui_balance_mist)
  const player_kares = useAppStore((app) => app.session.kares_balance)
  const { snapshot, routes } = kiosk
  if (!snapshot || !routes) return null
  const balances = {
    deposit: { sui: player_sui, kares: player_kares },
    withdraw: { sui: BigInt(snapshot.inventory.sui_mist), kares: token_balance(snapshot.inventory.kares_mist) },
  }
  const configured = token === 'sui' || snapshot.inventory.kares_mist !== null
  const balance = balances[direction][token]
  const route = routes[direction]
  const intent = coin_transfer_intent({ token, amount, reserve, balance, recipient: route.recipient })
  const can_review = [configured, route.offer, intent, !estimating].every(Boolean)
  const review = () => {
    if (!can_review || !route.offer || !intent) return
    kiosk.set_review({ actions: route.offer, intent })
    close()
  }
  const maximum = () => {
    if (!route.offer || balance === null || estimating) return
    const quoted_amount = token === 'sui' ? '0.000000001' : format_sui(balance, 9)
    const seed = coin_transfer_intent({ token, amount: quoted_amount, reserve, balance, recipient: route.recipient })
    if (!seed) return
    set_estimating(true)
    set_error('')
    void route.offer
      .prepare(seed)
      .then((quote) => {
        if (!quote.gas_budget_mist) throw new Error('Gas budget is unavailable.')
        const available = {
          sui: balance - BigInt(quote.gas_budget_mist) - parse_asset_amount(reserve)!,
          kares: balance,
        }[token]
        set_amount(format_sui(available > 0n ? available : 0n, 9))
      })
      .catch((reason) => set_error(readable_transaction_error(reason)))
      .finally(() => set_estimating(false))
  }
  return (
    <SendModalShell
      close={close}
      close_label={copy.wallet_close}
      locked={estimating}
      title={copy_text(copy.ui)('agent_coin_transfer', { token: token.toUpperCase() })}
    >
      <div className="agent-coin-form">
        <div className="flex gap-2">
          {(['deposit', 'withdraw'] as const).map((choice) => (
            <Button
              key={choice}
              aria-pressed={direction === choice}
              disabled={estimating || !routes[choice].offer}
              onClick={() => {
                set_direction(choice)
                set_amount('')
                set_error('')
              }}
            >
              {copy.ui[choice === 'deposit' ? 'agent_deposit' : 'agent_withdraw']}
            </Button>
          ))}
        </div>
        <p role="status" hidden={configured}>
          {copy.ui.agent_asset_unconfigured}
        </p>
        <p hidden={!!routes.deposit.offer}>{copy.ui.agent_pair_for_deposit}</p>
        <p>
          {copy.ui.agent_source_balance}: {balance === null ? '—' : format_sui(balance, 9)} {token.toUpperCase()}
        </p>
        <p className="break-all">
          {copy.ui.agent_transfer_sender}: {route.sender}
        </p>
        <p className="break-all">
          {copy.ui.agent_transfer_recipient}: {route.recipient}
        </p>
        <label>
          {copy.ui[`agent_asset_${token}`]}
          <input
            disabled={estimating}
            inputMode="decimal"
            value={amount}
            onChange={(event) => set_amount(event.target.value)}
          />
        </label>
        <Button disabled={!configured || estimating} onClick={maximum}>
          {copy_text(copy.characters_page)('common.max')}
        </Button>
        <label>
          {copy.ui.agent_asset_reserve}
          <input
            disabled={estimating}
            inputMode="decimal"
            value={reserve}
            onChange={(event) => set_reserve(event.target.value)}
          />
        </label>
        <p role="alert" hidden={!error}>
          {error}
        </p>
        <p>{copy.ui.agent_coin_direct}</p>
        <Button disabled={!can_review} onClick={review}>
          {copy.ui.agent_transfer_review}
        </Button>
      </div>
    </SendModalShell>
  )
}
