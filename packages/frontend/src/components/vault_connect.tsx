// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Wallet as WalletGlyph } from 'lucide-react'
import { getWallets, isWalletWithRequiredFeatureSet } from '@mysten/wallet-standard'
import { isEnokiWallet } from '@mysten/enoki'
import type { Wallet } from '@mysten/wallet-standard'

import { use_auth, find_wallet, type AuthState } from '../auth'

// ── WALLETS-ONLY CONNECT (/mint scope) ───────────────────────────────────────────────────────
// The crowdfund page offers REAL Sui wallets ONLY — no Enoki/zkLogin/Google, and it never surfaces an
// Enoki-derived address. This is a PAGE-SCOPED restriction achieved by filtering the wallet-standard registry
// itself (isEnokiWallet drops the Google zkLogin wallet) — the app's GLOBAL auth flow (use_auth.login, the
// SpectateLanding Google button) is left entirely untouched. The buy still routes through the same signer;
// we only narrow which identities can connect HERE.
const REQUIRED_FEATURES = ['sui:signPersonalMessage', 'sui:signTransaction']

function list_real_wallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => isWalletWithRequiredFeatureSet(w, REQUIRED_FEATURES) && !isEnokiWallet(w))
}

/** A live, non-Enoki Sui wallet list — reactive to browser wallet (un)registration. */
function useRealWallets(): Wallet[] {
  const [wallets, set_wallets] = useState<Wallet[]>(list_real_wallets)
  useEffect(() => {
    const registry = getWallets()
    const sync = () => set_wallets(list_real_wallets())
    const off_register = registry.on('register', sync)
    const off_unregister = registry.on('unregister', sync)
    sync() // a wallet may have registered between initial state and effect mount
    return () => {
      off_register()
      off_unregister()
    }
  }, [])
  return wallets
}

/**
 * Is the CURRENT session a real (non-Enoki) wallet? A globally-signed-in Enoki/Google session must NOT count
 * as connected on /mint (never display an Enoki address here) — it's treated as logged-out so the
 * page prompts a real-wallet connect instead.
 */
export function is_real_wallet_session(wallet_name: string | null): boolean {
  if (!wallet_name) return false
  const wallet = find_wallet(wallet_name)
  return !!wallet && !isEnokiWallet(wallet)
}

export function WalletConnectModal({ open, on_close }: { open: boolean; on_close: () => void }) {
  const { t } = useTranslation()
  const login = use_auth((s: AuthState) => s.login)
  const is_loading = use_auth((s: AuthState) => s.is_loading)
  const wallets = useRealWallets()
  const [connecting, set_connecting] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open, on_close])

  if (!open) return null

  const connect = async (name: string) => {
    if (connecting) return
    set_connecting(name)
    const address = await login(name).catch(() => null)
    set_connecting(null)
    if (address) on_close()
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      style={{ background: 'rgba(6,6,10,.74)', backdropFilter: 'blur(6px)' }}
      onClick={on_close}
    >
      <div
        className="relative w-full max-w-[420px] border border-gold/30 p-8 max-md:p-6"
        style={{
          background: 'linear-gradient(165deg,#15151f,#0b0b12)',
          boxShadow: '0 0 0 1px rgba(200,150,60,.12), 0 24px 60px rgba(0,0,0,.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={on_close}
          aria-label={t('vault.connect_close')}
          className="absolute top-4 right-4 text-muted hover:text-gold transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="text-gold text-[11px] tracking-[0.3em] uppercase font-semibold">{t('vault.connect_title')}</div>
        <p className="text-muted text-[13px] font-light mt-2.5 mb-7 leading-[1.55]">{t('vault.connect_subtitle')}</p>

        {wallets.length === 0 ? (
          <div className="border border-border bg-surface/60 px-5 py-8 text-center">
            <WalletGlyph size={22} className="mx-auto text-muted opacity-50" strokeWidth={1.5} />
            <div className="text-text text-[13px] font-medium mt-3.5">{t('vault.no_wallets')}</div>
            <div className="text-muted text-[12px] font-light mt-2 leading-[1.55]">{t('vault.no_wallets_hint')}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {wallets.map((w) => (
              <button
                key={w.name}
                type="button"
                onClick={() => connect(w.name)}
                disabled={!!connecting || is_loading}
                className="flex items-center gap-3.5 w-full px-4 py-3.5 border border-border bg-surface text-left transition-all hover:border-gold/50 hover:bg-white/[0.03] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {w.icon ? (
                  <img src={w.icon} alt="" className="w-7 h-7 object-contain shrink-0" />
                ) : (
                  <WalletGlyph size={22} className="text-gold shrink-0" />
                )}
                <span className="text-[13px] text-text font-medium flex-1 truncate">{w.name}</span>
                <span className="text-[11px] tracking-[0.16em] uppercase text-muted shrink-0">
                  {connecting === w.name ? t('vault.connecting') : t('vault.connect_action')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
