// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowLeftRight, Bot, Check, Copy, Gamepad2, LogOut, Plus, Send } from 'lucide-react'
import { Button, IconButton, WalletView, SuiLogo } from '@aresrpg/ui'
import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { display_suins_name } from '@aresrpg/immutable'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useSiteStore } from '../store.ts'
import { WalletTransferModal } from '../agents/WalletTransferModal.tsx'
import { recall_funding_authorization } from '../funding/recipient.ts'
import { toast } from '../toast.ts'

import { SendSuiModal } from './SendSuiModal.tsx'
import { KaresLogo } from './KaresLogo.tsx'

const wallet_identity = (address: string | null, name: string | null, fallback: string): string => {
  if (name) return display_suins_name(name)
  return address ? `${address.slice(0, 8)}…${address.slice(-5)}` : fallback
}
const balance_label = (value: bigint | null, format: (value: bigint) => string): string =>
  value === null ? '—' : format(value)
/** KARES is shown in whole tokens: a wallet holds thousands, and the fraction is noise. */
const whole_kares =
  (numbers: Readonly<{ amount: (value: bigint, decimals?: number) => string }>) =>
  (value: bigint): string =>
    numbers.amount(value, 0)

export type WalletShown = 'game' | 'bot'
type WalletModal = 'send' | 'transfer' | null
/** The owner's bot wallet, once its hosted signer is verified for this account. */
export const bot_pairing = ({ wallet, inventory_pairing }: SessionState) =>
  wallet && inventory_pairing?.signer_mode === 'host-persistent' ? inventory_pairing : null
/** The wallet on screen: the bot's only while the owner has a verified bot, else the game wallet. */
export const shown_wallet = (session: SessionState, chosen: WalletShown): WalletShown =>
  chosen === 'bot' && bot_pairing(session) ? 'bot' : 'game'

/** Copies the address on screen; the tick shows for two seconds. */
const AddressLine = ({ copy, address, text }: Readonly<{ copy: AppCopy; address: string | null; text: string }>) => {
  const [copied, set_copied] = useState(false)
  const copy_address = () => {
    if (!address) return
    void navigator.clipboard.writeText(address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }
  return (
    <span className="wallet-popover__identity">
      <strong>{text}</strong>
      <IconButton
        label={copy.wallet_copy_address}
        disabled={!address}
        onClick={copy_address}
        icon={copied ? <Check size={16} /> : <Copy size={16} />}
      />
    </span>
  )
}

type Account = Readonly<{
  address: string | null
  text: string
  sui: bigint | null
  kares: bigint | null
  signer: string
}>
/** What the wallet on screen holds: the bot wallet from the account subscription, else the game wallet. */
const shown_account = (
  session: SessionState,
  bot: ReturnType<typeof bot_pairing>,
  copy: AppCopy,
  name: string | null
): Account =>
  bot
    ? {
        address: bot.address,
        text: wallet_identity(bot.address, null, ''),
        sui: session.agent_inventory.sui_balance_mist,
        kares: session.agent_inventory.kares_balance,
        signer: copy.ui.wallet_bot_signs,
      }
    : {
        address: session.wallet?.address ?? null,
        text: wallet_identity(session.wallet?.address ?? null, name, copy.sign_in_to_play),
        sui: session.sui_balance_mist,
        kares: session.kares_balance,
        signer: copy.ui.wallet_you_sign,
      }

/** The steps a wallet action opens. Each needs the signed-in owner; Transfer also needs the bot wallet. */
const WalletSteps = ({
  copy,
  session,
  on_bot,
  modal,
  close,
}: Readonly<{
  copy: AppCopy
  session: SessionState
  on_bot: boolean
  modal: WalletModal
  close: () => void
}>) => {
  const { wallet } = session
  const pairing = bot_pairing(session)
  const resolve_character = useCallback(
    (name: string): Promise<Readonly<{ address: string; name: string }>> =>
      new Promise((resolve, reject) => dispatch_app({ type: 'wallet/resolve_character', name, resolve, reject })),
    []
  )
  if (!wallet || !modal) return null
  const steps = {
    send: () => (
      <SendSuiModal
        balance_mist={session.sui_balance_mist}
        close={close}
        copy={copy}
        on_sent={() => dispatch_app({ type: 'wallet/refresh' })}
        open_funds={() => {
          close()
          dispatch_app({ type: 'funding/open' })
        }}
        resolve_character={resolve_character}
        wallet={wallet}
      />
    ),
    transfer: () =>
      pairing && <WalletTransferModal copy={copy} direction={on_bot ? 'withdraw' : 'deposit'} close={close} />,
  }
  return steps[modal]()
}

const WalletFooter = ({
  copy,
  session,
  disconnect,
}: Readonly<{ copy: AppCopy; session: SessionState; disconnect: () => void }>) => {
  const numbers = useNumbers()
  return (
    <>
      <div className="wallet-popover__gas">
        <span>{copy.wallet_gas_spent}</span>
        <strong>{numbers.sui(session.gas_spent_mist, 4)} SUI</strong>
      </div>
      <Button disabled={!session.wallet} onClick={disconnect}>
        <LogOut size={16} />
        {copy.wallet_disconnect}
      </Button>
    </>
  )
}

/**
 * A step belongs to the wallet it was opened for: if the shown wallet changes under it (the bot is
 * replaced, or its pairing is lost), it closes, so a checkout or a transfer never continues toward
 * another wallet.
 */
const useWalletStep = (wallet: string | null) => {
  const [opened, set_opened] = useState<Readonly<{ step: Exclude<WalletModal, null>; wallet: string | null }> | null>(
    null
  )
  const step = opened?.wallet === wallet ? opened.step : null
  if (opened && !step) set_opened(null)
  return {
    step,
    open: (next: Exclude<WalletModal, null>) => set_opened({ step: next, wallet }),
    close: () => set_opened(null),
  }
}

/**
 * Add funds for the wallet on screen, through the one funding window: the game wallet's own top-up, or
 * the bot wallet once the owner's proof of it verifies.
 */
const open_funding = (copy: AppCopy, session: SessionState, bot: ReturnType<typeof bot_pairing>): void => {
  if (!bot) return dispatch_app({ type: 'funding/open' })
  const authorization = recall_funding_authorization(session, bot)
  if (!authorization) return toast.add(copy.ui.agent_funding_unverified, 'error')
  dispatch_app({ type: 'funding/open', cost_mist: 0n, authorization })
}

/**
 * The one wallet of every page: the game wallet, and the bot wallet as a second tab once the owner
 * has a verified bot. Add funds pays into the wallet on screen; Transfer moves SUI or KARES between
 * the two and starts from the wallet on screen. Money leaves the bot wallet only through Transfer.
 * `compact` is the site bar's small trigger; `embedded` lays the card in its host with no trigger. A page
 * whose content follows the wallet on screen holds that choice itself (`shown`).
 */
export const WalletCard = ({
  copy,
  disconnect,
  session,
  embedded = false,
  compact = false,
  shown,
}: Readonly<{
  copy: AppCopy
  disconnect: () => void
  session: SessionState
  embedded?: boolean
  compact?: boolean
  shown?: Readonly<{ value: WalletShown; change: (value: WalletShown) => void }>
}>) => {
  const numbers = useNumbers()
  const default_name = useSiteStore((state) => state.suins.snapshot?.default_name ?? null)
  const menu_id = useId()
  const menu = useRef<HTMLElement>(null)
  const own = useState<WalletShown>('game')
  const [chosen, set_chosen] = shown ? [shown.value, shown.change] : own
  const pairing = bot_pairing(session)
  const on_screen = shown_wallet(session, chosen)
  const on_bot = on_screen === 'bot'
  const bot = on_bot ? pairing : null
  const account = shown_account(session, bot, copy, default_name)
  const steps = useWalletStep(account.address)
  const open = (next: Exclude<WalletModal, null> | 'funds') => {
    if (!embedded) menu.current?.hidePopover()
    if (next === 'funds') open_funding(copy, session, bot)
    else steps.open(next)
  }
  // The trigger is the card's anchor: one name per card (`app_layout.css`).
  const anchor = { '--wallet-anchor': `--wallet-${menu_id.replace(/[^a-z0-9_-]/gi, '')}` } as CSSProperties
  const panel_attributes = embedded
    ? { className: 'wallet-panel' }
    : { className: 'aui-panel wallet-panel wallet-popover', popover: 'auto' as const, role: 'dialog', style: anchor }
  const tabs = {
    label: copy.ui.wallet_tabs,
    value: on_screen,
    on_change: set_chosen,
    options: [
      { value: 'game' as const, label: copy.ui.wallet_game, icon: <Gamepad2 size={16} /> },
      { value: 'bot' as const, label: copy.ui.wallet_bot, icon: <Bot size={16} /> },
    ],
  }
  return (
    <>
      {!embedded && (
        <WalletTrigger
          label={copy.account}
          sui_balance_mist={session.sui_balance_mist}
          kares_balance={session.kares_balance}
          popover_target={menu_id}
          anchor={anchor}
          compact={compact}
        />
      )}
      <section {...panel_attributes} id={menu_id} ref={menu} aria-label={copy.account} data-wallet-card="">
        <WalletView<WalletShown>
          wallets={pairing ? tabs : undefined}
          signer={account.signer}
          address={<AddressLine copy={copy} address={account.address} text={account.text} />}
          main={{ value: balance_label(account.sui, numbers.sui), unit: 'SUI' }}
          main_icon={<SuiLogo size={30} />}
          second={{ value: balance_label(account.kares, whole_kares(numbers)), unit: 'KARES' }}
          second_icon={<KaresLogo size={18} />}
          actions={
            <WalletActions copy={copy} open={open} enabled={!!session.wallet} transfer={!!pairing} send={!on_bot} />
          }
        >
          <WalletFooter copy={copy} session={session} disconnect={disconnect} />
        </WalletView>
      </section>
      <WalletSteps copy={copy} session={session} on_bot={on_bot} modal={steps.step} close={steps.close} />
    </>
  )
}

const WalletActions = ({
  copy,
  open,
  enabled,
  transfer,
  send,
}: Readonly<{
  copy: AppCopy
  open: (modal: Exclude<WalletModal, null> | 'funds') => void
  enabled: boolean
  transfer: boolean
  send: boolean
}>): ReactNode => (
  <>
    <Button tone="primary" disabled={!enabled} onClick={() => open('funds')}>
      <Plus size={16} />
      {copy.wallet_add_funds}
    </Button>
    {transfer && (
      <Button onClick={() => open('transfer')}>
        <ArrowLeftRight size={16} />
        {copy.ui.wallet_transfer}
      </Button>
    )}
    {send && (
      <Button disabled={!enabled} onClick={() => open('send')}>
        <Send size={16} />
        {copy.wallet_send}
      </Button>
    )}
  </>
)

/** The button that opens the card: the game wallet's two balances. */
const WalletTrigger = ({
  label,
  sui_balance_mist,
  kares_balance,
  popover_target,
  anchor,
  compact,
}: Readonly<{
  label: string
  sui_balance_mist: bigint | null
  kares_balance: bigint | null
  popover_target: string
  anchor: CSSProperties
  compact: boolean
}>) => {
  const numbers = useNumbers()
  const sui = balance_label(sui_balance_mist, numbers.sui)
  const kares = balance_label(kares_balance, whole_kares(numbers))
  return (
    <button
      type="button"
      popoverTarget={popover_target}
      aria-haspopup="dialog"
      className={compact ? 'aui-button wallet-trigger wallet-trigger--compact' : 'wallet-trigger'}
      style={anchor}
      data-wallet-trigger=""
      aria-label={label}
      aria-description={`${sui} SUI · ${kares} KARES`}
      title={label}
    >
      <span className="wallet-trigger__balance" title={`${sui} SUI`}>
        <SuiLogo size={16} />
        <span>{sui}</span>
      </span>
      <span className="wallet-trigger__balance wallet-trigger__balance--kares" title={`${kares} KARES`}>
        <KaresLogo size={16} />
        <span>{kares}</span>
      </span>
    </button>
  )
}
