// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, ChevronDown, Copy, LogOut, Plus, Send, Wallet } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { display_suins_name } from '../leaderboards/presentation.ts'
import { format_sui } from '../wallet_amount.ts'
import { format_amount } from '../kares/model.ts'

import { AddFundsModal } from './AddFundsModal.tsx'
import { SendSuiModal } from './SendSuiModal.tsx'
import { KaresLogo } from './KaresLogo.tsx'

const short_address = (address: string): string => `${address.slice(0, 8)}…${address.slice(-5)}`

export const WalletCard = ({
  copy,
  disconnect,
  session,
}: Readonly<{ copy: AppCopy; disconnect: () => void; session: SessionState }>) => {
  const default_name = useAppStore((state) => state.suins.snapshot?.default_name ?? null)
  const menu_id = useId()
  const menu = useRef<HTMLElement>(null)
  const [copied, set_copied] = useState(false)
  const [modal, set_modal] = useState<'funds' | 'send' | null>(null)
  const { wallet } = session
  const resolve_character = useCallback(
    (name: string): Promise<Readonly<{ address: string; name: string }>> =>
      new Promise((resolve, reject) => dispatch_app({ type: 'wallet/resolve_character', name, resolve, reject })),
    []
  )
  if (!wallet) return null
  const { address } = wallet
  const sui_balance = session.sui_balance_mist === null ? '—' : format_sui(session.sui_balance_mist, 2)
  const open_modal = (next: 'funds' | 'send'): void => {
    menu.current?.hidePopover()
    set_modal(next)
  }

  const copy_address = (): void => {
    void navigator.clipboard.writeText(address).then(() => {
      set_copied(true)
      setTimeout(() => set_copied(false), 2_000)
    })
  }

  return (
    <>
      <button
        aria-label={copy.account}
        aria-haspopup="dialog"
        className="wallet-trigger"
        data-wallet-trigger=""
        popoverTarget={menu_id}
        type="button"
      >
        <span className="wallet-trigger__icon">
          <Wallet aria-hidden="true" size={16} />
        </span>
        <span className="wallet-trigger__identity" title={address}>
          <span className="wallet-trigger__label">{copy.account}</span>
          <span>{default_name ? display_suins_name(default_name) : short_address(address)}</span>
        </span>
        <span className="wallet-trigger__balance">{sui_balance} SUI</span>
        <ChevronDown aria-hidden="true" className="wallet-trigger__chevron" size={16} />
      </button>
      <section
        className="wallet-popover flex flex-col gap-3 border border-gold/40 bg-surface p-4 text-text"
        id={menu_id}
        popover="auto"
        ref={menu}
        role="dialog"
        aria-label={copy.account}
        data-wallet-card=""
      >
        <div className="flex items-center gap-2">
          <Wallet className="shrink-0 text-[#c8963c] opacity-60" size={12} />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] tracking-wide text-[#c8963c]">
            {short_address(address)}
          </span>
          <button
            aria-label={copy.wallet_copy_address}
            className="shrink-0 cursor-pointer opacity-45 hover:opacity-90"
            onClick={copy_address}
            type="button"
          >
            {copied ? <Check className="text-emerald-400" size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[22px] font-semibold text-text">{sui_balance}</span>
          <span className="text-[12px] tracking-wide text-muted uppercase">SUI</span>
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-gold" data-kares-balance="">
          <KaresLogo size={16} />
          <span className="tabular-nums">
            {session.kares_balance === null ? '—' : format_amount(session.kares_balance)}
          </span>
          <span className="text-[11px] text-muted">KARES</span>
        </div>
        <div className="grid grid-cols-2 gap-2" data-wallet-actions="">
          <button
            className="flex w-full cursor-pointer items-center gap-2 border border-[#4a9eff]/30 bg-[linear-gradient(135deg,rgba(74,158,255,0.15)_0%,rgba(77,227,255,0.07)_48%,rgba(18,18,26,0.72)_100%)] px-2.5 py-2.5 text-[11px] tracking-[0.1em] text-[#67adff] uppercase shadow-[0_0_16px_rgba(74,158,255,0.05)] transition-all hover:border-[#4a9eff]/60 hover:shadow-[0_0_20px_rgba(74,158,255,0.1)]"
            onClick={() => open_modal('send')}
            type="button"
          >
            <Send size={14} /> {copy.wallet_send}
          </button>
          <button
            className="flex w-full cursor-pointer items-center gap-2 border border-[#c8963c]/30 bg-[linear-gradient(135deg,rgba(200,150,60,0.16)_0%,rgba(240,196,116,0.07)_48%,rgba(18,18,26,0.72)_100%)] px-2.5 py-2.5 text-[11px] tracking-[0.1em] text-[#d9ad5c] uppercase shadow-[0_0_16px_rgba(200,150,60,0.05)] transition-all hover:border-[#c8963c]/60 hover:shadow-[0_0_20px_rgba(200,150,60,0.1)]"
            onClick={() => open_modal('funds')}
            type="button"
          >
            <Plus size={14} /> {copy.wallet_add_funds}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/8 pt-2 text-[11px]">
          <span className="tracking-[0.08em] text-[#777b86]">{copy.wallet_gas_spent}</span>
          <span className="shrink-0 whitespace-nowrap font-mono text-[#d6d1c8] tabular-nums">
            {format_sui(session.gas_spent_mist, 4)} SUI
          </span>
        </div>
        <button
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 border border-white/8 px-2 py-2 text-[10px] tracking-[0.16em] text-[#777b86] uppercase hover:text-red-400"
          onClick={() => {
            menu.current?.hidePopover()
            disconnect()
          }}
          type="button"
        >
          <LogOut size={10} /> {copy.wallet_disconnect}
        </button>
      </section>

      {modal === 'funds' && <AddFundsModal address={address} copy={copy} on_close={() => set_modal(null)} />}
      {modal === 'send' && (
        <SendSuiModal
          balance_mist={session.sui_balance_mist}
          close={() => set_modal(null)}
          copy={copy}
          on_sent={() => dispatch_app({ type: 'wallet/refresh' })}
          open_funds={() => set_modal('funds')}
          resolve_character={resolve_character}
          wallet={wallet}
        />
      )}
    </>
  )
}
