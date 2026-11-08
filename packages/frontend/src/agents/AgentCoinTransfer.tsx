// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button } from '@aresrpg/ui'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk'
import { Loader2, Send } from 'lucide-react'

import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { format_sui } from '../wallet_amount.ts'
import { useAppStore } from '../store.ts'
import { readable_transaction_error } from '../transaction_guard.ts'
import { SendModalShell } from '../components/SendModalShell.tsx'
import { send_text } from '../components/SuiTransferResult.tsx'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { KaresLogo } from '../components/KaresLogo.tsx'

import type { AgentKioskController } from './useAgentKiosk.ts'
import { coin_transfer_intent, type TransferDirection, type TransferToken } from './inventory_transfer.ts'

const coin_marks = {
  sui: (
    <span className="agent-sui-mark">
      <SuiLogo size={22} />
    </span>
  ),
  kares: <KaresLogo size={22} />,
}
const token_balance = (value: string | null): bigint | null => (value === null ? null : BigInt(value))
const reserve = format_sui(GAS_BUDGET_MIST, 2)

const useAgentCoinForm = ({
  token,
  kiosk,
  copy,
  close,
}: Readonly<{ token: TransferToken; kiosk: AgentKioskController; copy: AppCopy; close: () => void }>) => {
  const [direction, set_direction] = useState<TransferDirection>('withdraw')
  const [amount, set_amount] = useState('')
  const [estimating, set_estimating] = useState(false)
  const [error, set_error] = useState('')
  const player_sui = useAppStore((app) => app.session.sui_balance_mist)
  const player_kares = useAppStore((app) => app.session.kares_balance)
  const snapshot = kiosk.snapshot!
  const routes = kiosk.routes!
  const balances = {
    deposit: { sui: player_sui, kares: player_kares },
    withdraw: { sui: BigInt(snapshot.inventory.sui_mist), kares: token_balance(snapshot.inventory.kares_mist) },
  }
  const configured = token === 'sui' || snapshot.inventory.kares_mist !== null
  const balance = balances[direction][token],
    route = routes[direction]
  const intent = coin_transfer_intent({ token, amount, reserve, balance, recipient: route.recipient })
  const can_send = [configured, route.offer, intent, !estimating, !kiosk.busy, !kiosk.blocked].every(Boolean)
  const send = () => {
    if (!can_send || !route.offer || !intent) return
    const pending = kiosk.execute(route.offer, intent)
    if (pending) void pending.then(close, () => undefined)
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
        const available = { sui: balance - BigInt(quote.gas_budget_mist) - BigInt(GAS_BUDGET_MIST), kares: balance }[
          token
        ]
        set_amount(format_sui(available > 0n ? available : 0n, 9))
      })
      .catch((reason) => set_error(readable_transaction_error(reason)))
      .finally(() => set_estimating(false))
  }
  return {
    direction,
    set_direction,
    amount,
    set_amount,
    estimating,
    error: error || kiosk.transaction.error,
    set_error,
    balance,
    configured,
    routes,
    can_send,
    send,
    maximum,
  }
}

export const AgentCoinTransfer = ({
  token,
  kiosk,
  copy,
  close,
}: Readonly<{ token: TransferToken; kiosk: AgentKioskController; copy: AppCopy; close: () => void }>) => {
  const form = useAgentCoinForm({ token, kiosk, copy, close })
  const {
    direction,
    set_direction,
    amount,
    set_amount,
    estimating,
    error,
    set_error,
    balance,
    configured,
    routes,
    can_send,
    send,
    maximum,
  } = form
  return (
    <SendModalShell
      close={close}
      close_label={copy.wallet_close}
      locked={kiosk.busy}
      title={copy_text(copy.ui)('agent_coin_transfer', { token: token.toUpperCase() })}
    >
      {kiosk.busy ? (
        <AgentCoinPending kiosk={kiosk} copy={copy} />
      ) : (
        <div className="agent-coin-form">
          <div className="agent-coin-directions">
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
                {copy.ui[`agent_${choice}`]}
              </Button>
            ))}
          </div>
          {!configured && (
            <p className="agent-transfer-note" role="status">
              {copy.ui.agent_asset_unconfigured}
            </p>
          )}
          {!routes.deposit.offer && <p className="agent-transfer-note">{copy.ui.agent_pair_for_deposit}</p>}
          <div>
            <div className="agent-coin-amount-heading">
              <span>{send_text(copy, 'amount_label')}</span>
              <span>
                {balance === null ? '—' : format_sui(balance, 4)} {token.toUpperCase()}
              </span>
              <Button disabled={!configured || estimating} onClick={maximum}>
                {copy_text(copy.characters_page)('common.max')}
              </Button>
            </div>
            <label className="agent-coin-amount">
              {coin_marks[token]}
              <input
                aria-label={copy.ui[`agent_asset_${token}`]}
                disabled={estimating}
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => set_amount(event.target.value)}
              />
              <span>{token.toUpperCase()}</span>
            </label>
          </div>
          <div className="agent-coin-reserve">
            <span>{copy.ui.agent_asset_reserve}</span>
            <span>{reserve} SUI</span>
          </div>
          {error && (
            <p className="agent-transfer-error" role="alert">
              {error}
            </p>
          )}
          <div className="agent-coin-actions">
            <Button tone="primary" disabled={!can_send} onClick={send}>
              <Send size={12} />
              {copy.ui[`agent_${direction}`]}
            </Button>
            <Button onClick={close}>{copy.wallet_send_shared.cancel}</Button>
          </div>
        </div>
      )}
    </SendModalShell>
  )
}

const AgentCoinPending = ({ kiosk, copy }: Readonly<{ kiosk: AgentKioskController; copy: AppCopy }>) => (
  <div className="flex flex-col items-center gap-5 py-8" role="status">
    <Loader2 className="animate-spin text-gold opacity-80" size={28} />
    <div className="text-center text-[11px] tracking-[0.2em] text-text uppercase">
      {send_text(copy, kiosk.transaction.phase === 'preparing' ? 'building_body' : 'executing_body')}
    </div>
  </div>
)
