// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowLeftRight, Bot, Check, Copy, Gamepad2, LogOut, Plus, Send } from 'lucide-react'
import { Button, IconButton, WalletView } from '@aresrpg/ui'
import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { display_suins_name } from '@aresrpg/immutable'

import { useNumbers } from '../i18n/useNumbers.ts'
import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { AgentTransferFunding } from '../agents/AgentTransferFunding.tsx'
import { WalletTransferModal } from '../agents/WalletTransferModal.tsx'

import { SendSuiModal } from './SendSuiModal.tsx'
import { SuiLogo } from './SuiLogo.tsx'
import { KaresLogo } from './KaresLogo.tsx'

const wallet_identity = (address: string | null, name: string | null, fallback: string): string => {
  if (name) return display_suins_name(name)
  return address ? `${address.slice(0, 8)}…${address.slice(-5)}` : fallback
}
const balance_label = (value: bigint | null, format: (value: bigint) => string): string =>
  value === null ? '—' : format(value)

type Shown = 'game' | 'bot'
type WalletModal = 'send' | 'funds' | 'transfer' | null
/** The owner's bot wallet, once its hosted signer is verified for this account. */
const bot_pairing = ({ wallet, inventory_pairing }: SessionState) =>
  wallet && inventory_pairing?.signer_mode === 'host-persistent' ? inventory_pairing : null

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
  account,
  on_bot,
  modal,
  open,
  close,
}: Readonly<{
  copy: AppCopy
  session: SessionState
  account: Account
  on_bot: boolean
  modal: WalletModal
  open: (modal: Exclude<WalletModal, null>) => void
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
        open_funds={() => open('funds')}
        resolve_character={resolve_character}
        wallet={wallet}
      />
    ),
    funds: () => (
      <AgentTransferFunding
        copy={copy}
        wallet={wallet}
        sender={account.address}
        pairing={on_bot ? pairing : undefined}
        close={close}
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
      {session.wallet ? (
        <Button onClick={disconnect}>
          <LogOut size={16} />
          {copy.wallet_disconnect}
        </Button>
      ) : (
        <a className="aui-button aui-button--primary" href="/">
          {copy.sign_in}
        </a>
      )}
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
 * The one wallet of every page: the game wallet, and the bot wallet as a second tab once the owner
 * has a verified bot. Add funds pays into the wallet on screen; Transfer moves SUI or KARES between
 * the two and starts from the wallet on screen. Money leaves the bot wallet only through Transfer.
 * `standalone` pages have no player runtime, so the game wallet's funding opens here too.
 */
export const WalletCard = ({
  copy,
  disconnect,
  session,
  embedded = false,
  standalone = false,
}: Readonly<{
  copy: AppCopy
  disconnect: () => void
  session: SessionState
  embedded?: boolean
  standalone?: boolean
}>) => {
  const numbers = useNumbers()
  const default_name = useAppStore((state) => state.suins.snapshot?.default_name ?? null)
  const menu_id = useId()
  const menu = useRef<HTMLElement>(null)
  const [chosen, set_chosen] = useState<Shown>('game')
  const pairing = bot_pairing(session)
  const on_bot = [pairing, chosen === 'bot'].every(Boolean)
  const account = shown_account(session, on_bot ? pairing : null, copy, default_name)
  const steps = useWalletStep(account.address)
  const open = (next: Exclude<WalletModal, null>) => {
    if (!embedded) menu.current?.hidePopover()
    // The player runtime owns the game wallet's funding dialog where it exists.
    const runtime_funding = [next === 'funds', !on_bot, !standalone].every(Boolean)
    return runtime_funding ? dispatch_app({ type: 'dialog/open', dialog: 'top_up' }) : steps.open(next)
  }
  const panel_attributes = embedded
    ? { className: 'wallet-panel' }
    : { className: 'aui-panel wallet-panel wallet-popover', popover: 'auto' as const, role: 'dialog' }
  const tabs = {
    label: copy.ui.wallet_tabs,
    value: on_bot ? ('bot' as const) : ('game' as const),
    on_change: set_chosen,
    options: [
      { value: 'game' as const, label: copy.ui.wallet_game, icon: <Gamepad2 size={16} /> },
      { value: 'bot' as const, label: copy.ui.wallet_bot, icon: <Bot size={16} /> },
    ],
  }
  return (
    <>
      {!embedded && (
        <WalletBalanceBox
          label={copy.account}
          sui_balance_mist={session.sui_balance_mist}
          kares_balance={session.kares_balance}
          popover_target={menu_id}
          compact={standalone}
        />
      )}
      <section {...panel_attributes} id={menu_id} ref={menu} aria-label={copy.account} data-wallet-card="">
        <WalletView<Shown>
          wallets={pairing ? tabs : undefined}
          signer={account.signer}
          address={<AddressLine copy={copy} address={account.address} text={account.text} />}
          main={{ value: balance_label(account.sui, numbers.sui), unit: 'SUI' }}
          main_icon={<SuiLogo size={30} />}
          second={{ value: balance_label(account.kares, numbers.amount), unit: 'KARES' }}
          second_icon={<KaresLogo size={18} />}
          actions={
            <WalletActions copy={copy} open={open} enabled={!!session.wallet} transfer={!!pairing} send={!on_bot} />
          }
        >
          <WalletFooter copy={copy} session={session} disconnect={disconnect} />
        </WalletView>
      </section>
      <WalletSteps
        copy={copy}
        session={session}
        account={account}
        on_bot={on_bot}
        modal={steps.step}
        open={open}
        close={steps.close}
      />
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
  open: (modal: Exclude<WalletModal, null>) => void
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

/** One compact balance presentation for both wallets. */
export const WalletBalanceBox = ({
  label,
  sui_balance_mist,
  kares_balance,
  popover_target,
  icon,
  compact = false,
}: Readonly<{
  label: string
  sui_balance_mist: bigint | null
  kares_balance?: bigint | null
  popover_target?: string
  icon?: ReactNode
  compact?: boolean
}>) => {
  const numbers = useNumbers()
  const sui = balance_label(sui_balance_mist, numbers.sui)
  const kares = balance_label(kares_balance ?? null, numbers.amount)
  const Container = popover_target ? 'button' : 'div'
  const controls = popover_target
    ? { popoverTarget: popover_target, type: 'button' as const, 'aria-haspopup': 'dialog' as const }
    : {}
  return (
    <Container
      {...controls}
      className={compact ? 'aui-button wallet-trigger wallet-trigger--compact' : 'wallet-trigger'}
      data-wallet-trigger=""
      aria-label={label}
      aria-description={`${sui} SUI${kares_balance === undefined ? '' : ` · ${kares} KARES`}`}
      title={label}
    >
      {icon}
      <span className="wallet-trigger__balance" title={`${sui} SUI`}>
        <SuiLogo size={16} />
        <span>{sui}</span>
      </span>
      {kares_balance !== undefined && (
        <span className="wallet-trigger__balance wallet-trigger__balance--kares" title={`${kares} KARES`}>
          <KaresLogo size={16} />
          <span>{kares}</span>
        </span>
      )}
    </Container>
  )
}
