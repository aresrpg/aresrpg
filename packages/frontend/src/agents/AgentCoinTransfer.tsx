// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button, Field, SegmentedControl, WalletTransfer, type TransferLeg } from '@aresrpg/ui'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk'
import { Bot, Gamepad2, Loader2 } from 'lucide-react'

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

const token_balance = (value: string | null): bigint | null => (value === null ? null : BigInt(value))
const reserve = format_sui(GAS_BUDGET_MIST, 2)

type CoinFormProps = Readonly<{
  /** The coin and the direction the form opens on; both can be changed in the form. */
  token: TransferToken
  direction?: TransferDirection
  kiosk: AgentKioskController
  copy: AppCopy
  close: () => void
}>
const useAgentCoinForm = ({
  token: opened_token,
  direction: opened_direction = 'withdraw',
  kiosk,
  close,
}: CoinFormProps) => {
  const [direction, set_direction] = useState<TransferDirection>(opened_direction)
  const [token, set_token] = useState<TransferToken>(opened_token)
  const [amount, set_amount] = useState('')
  const [estimating, set_estimating] = useState(false)
  const [error, set_error] = useState('')
  const player_sui = useAppStore((app) => app.session.sui_balance_mist)
  const player_kares = useAppStore((app) => app.session.kares_balance)
  const snapshot = kiosk.snapshot!
  const routes = kiosk.routes!
  const balances = {
    deposit: { sui: player_sui, kares: player_kares },
    withdraw: { sui: token_balance(snapshot.inventory.sui_mist), kares: token_balance(snapshot.inventory.kares_mist) },
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
  /** A new coin or direction is a new transfer: the amount and any error belong to the old one. */
  const restart = (next: Readonly<{ token?: TransferToken; direction?: TransferDirection }>) => {
    // A maximum being estimated belongs to the current coin and direction: it lands before either changes.
    if (estimating) return
    set_token(next.token ?? token)
    set_direction(next.direction ?? direction)
    set_amount('')
    set_error('')
  }
  return {
    token,
    direction,
    restart,
    balances,
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

const OTHER = { deposit: 'withdraw', withdraw: 'deposit' } as const
/** The two ends of a transfer are always the owner's game wallet and bot wallet. */
const transfer_leg = (
  copy: AppCopy,
  side: TransferDirection,
  token: TransferToken,
  balance: bigint | null
): TransferLeg => ({
  // A deposit leaves the game wallet; a withdrawal leaves the bot wallet.
  name: side === 'deposit' ? copy.ui.wallet_game : copy.ui.wallet_bot,
  icon: side === 'deposit' ? <Gamepad2 size={18} /> : <Bot size={18} />,
  balance: balance === null ? null : { value: format_sui(balance, token === 'sui' ? 2 : 4), unit: token.toUpperCase() },
})

type CoinForm = ReturnType<typeof useAgentCoinForm>
/** The amount with its coin, what the sending wallet can move, and what the form has to say. */
const TransferFields = ({ form, copy }: Readonly<{ form: CoinForm; copy: AppCopy }>) => {
  const { token, restart, amount, estimating, error, balance, configured, routes } = form
  const decimals = token === 'sui' ? 2 : 4
  return (
    <>
      {!configured && (
        <p className="aui-wallet-note" role="status">
          {copy.ui.agent_asset_unconfigured}
        </p>
      )}
      {!routes.deposit.offer && <p className="aui-wallet-note">{copy.ui.agent_pair_for_deposit}</p>}
      <Field label={send_text(copy, 'amount_label')}>
        <span className="aui-wallet-amount">
          <input
            aria-label={copy.ui[`agent_asset_${token}`]}
            className="aui-input"
            disabled={estimating}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => form.set_amount(event.target.value)}
          />
          <SegmentedControl<TransferToken>
            label={copy.ui.wallet_coin}
            value={token}
            on_change={(next) => restart({ token: next })}
            options={[
              { value: 'sui', label: 'SUI', icon: <SuiLogo size={16} /> },
              { value: 'kares', label: 'KARES', icon: <KaresLogo size={16} /> },
            ]}
          />
        </span>
      </Field>
      <Button className="aui-wallet-max" disabled={[!configured, estimating].some(Boolean)} onClick={form.maximum}>
        {copy_text(copy.characters_page)('common.max')}
        <span className="aui-wallet-num">
          {balance === null ? '—' : format_sui(balance, decimals)} <i>{token.toUpperCase()}</i>
        </span>
      </Button>
      <p className="aui-wallet-note">
        {copy.ui.agent_asset_reserve}: {reserve} SUI
      </p>
      {error && (
        <p className="aui-wallet-note" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

/** The one coin transfer between the owner's two wallets: From over To, one swap, one action. */
const TransferForm = ({ form, copy }: Readonly<{ form: CoinForm; copy: AppCopy }>) => {
  const { token, direction, restart, balances, routes } = form
  const back = OTHER[direction]
  const swappable = [!form.estimating, routes[back].offer].every(Boolean)
  const action = copy_text(copy.ui)('wallet_transfer_to', {
    amount: form.amount || '0',
    token: token.toUpperCase(),
    wallet: direction === 'deposit' ? copy.ui.wallet_bot : copy.ui.wallet_game,
  })
  return (
    <WalletTransfer
      from_label={copy.ui.wallet_from}
      to_label={copy.ui.wallet_to}
      from={transfer_leg(copy, direction, token, balances[direction][token])}
      to={transfer_leg(copy, back, token, balances[back][token])}
      swap_label={copy.ui.wallet_swap}
      swap={swappable ? () => restart({ direction: back }) : null}
    >
      <TransferFields form={form} copy={copy} />
      <Button tone="primary" disabled={!form.can_send} onClick={form.send}>
        {action}
      </Button>
    </WalletTransfer>
  )
}

export const AgentCoinTransfer = (props: CoinFormProps) => {
  const { kiosk, copy, close } = props
  const form = useAgentCoinForm(props)
  return (
    <SendModalShell close={close} close_label={copy.wallet_close} locked={kiosk.busy} title={copy.ui.wallet_transfer}>
      {kiosk.busy ? <AgentCoinPending kiosk={kiosk} copy={copy} /> : <TransferForm form={form} copy={copy} />}
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
