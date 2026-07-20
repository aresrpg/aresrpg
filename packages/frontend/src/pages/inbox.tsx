import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox, Loader2, Wallet as WalletGlyph, LogOut } from 'lucide-react'

import { use_auth, type AuthState } from '../auth'
import { use_inbox } from '../stores/inbox'
import { WalletConnectModal, is_real_wallet_session } from '../components/vault_connect'
import { GiftCard, use_inbox_polling } from '../components/marketplace/inbox_panel'
import { truncate_address } from '../utils/address'

// EXTERNAL /inbox — the standalone claim page for NON-players: ONE /inbox page w/ wallet connect.
// A plain Sui wallet (not just a zkLogin identity) connects and claims the escrow-recoverable item gifts addressed
// to it — the claim mints the items straight into the wallet's own kiosk. Self-contained landing (its own header +
// Connect CTA, no game shell / sidebar), mounted OUTSIDE the auth gate in AppBody exactly like /mint. NO
// return-to-sender; the sender's own recall stays for OUTGOING rows a connected sender may hold.

function InboxList() {
  const { t } = useTranslation()
  const { incoming, outgoing, loading, loaded_once, busy_id, claim, recall } = use_inbox()
  use_inbox_polling()

  if (loading && !loaded_once)
    return (
      <div className="flex items-center justify-center gap-2 py-20">
        <Loader2 size={14} className="animate-spin text-gold opacity-40" />
        <span className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">{t('common.loading')}</span>
      </div>
    )

  if (incoming.length === 0 && outgoing.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted">
        <Inbox size={26} style={{ opacity: 0.2 }} />
        <span className="text-[10px] tracking-[0.2em] uppercase">{t('gift.inbox.empty')}</span>
        <span className="text-[9px] tracking-[0.12em] text-muted/60 max-w-[300px] leading-relaxed">
          {t('gift.inbox.empty_hint')}
        </span>
      </div>
    )

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        <div className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
          {t('gift.inbox.incoming')}
        </div>
        {incoming.length === 0 ? (
          <span className="text-[9px] tracking-[0.15em] uppercase text-muted/60">{t('gift.inbox.no_incoming')}</span>
        ) : (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {incoming.map((g) => (
              <GiftCard key={g.gift_id} gift={g} mode="incoming" busy={busy_id === g.gift_id} on_action={claim} />
            ))}
          </div>
        )}
      </section>
      {outgoing.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div className="text-[10px] tracking-[0.25em] uppercase font-semibold text-cyan">{t('gift.inbox.sent')}</div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {outgoing.map((g) => (
              <GiftCard key={g.gift_id} gift={g} mode="outgoing" busy={busy_id === g.gift_id} on_action={recall} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function InboxExternalPage() {
  const { t } = useTranslation()
  const address = use_auth((s: AuthState) => s.address)
  const wallet_name = use_auth((s: AuthState) => s.wallet_name)
  const logout = use_auth((s: AuthState) => s.logout)
  const [connect_open, set_connect_open] = useState(false)

  const connected = address != null && is_real_wallet_session(wallet_name)

  return (
    <div className="min-h-dvh bg-bg text-text flex flex-col">
      {/* Sticky header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-20 bg-bg/90 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="AresRPG"
            width={26}
            height={26}
            className="drop-shadow-[0_0_12px_rgba(200,150,60,0.3)]"
          />
          <span className="text-gradient font-bold tracking-[0.3em] text-[11px] uppercase">AresRPG</span>
          <span className="text-muted/50 text-[10px] tracking-[0.2em] uppercase ml-1">{t('gift.inbox.tab')}</span>
        </div>
        {connected ? (
          <div className="flex items-center gap-3">
            <span className="text-[10px] tracking-[0.12em] uppercase text-muted font-mono">
              {truncate_address(address!)}
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="text-muted hover:text-gold transition-colors cursor-pointer inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase"
            >
              <LogOut size={11} /> {t('gift.inbox.disconnect')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => set_connect_open(true)}
            className="btn-gold px-4 py-2 text-[10px] tracking-[0.2em] uppercase inline-flex items-center gap-2 cursor-pointer"
          >
            <WalletGlyph size={12} /> {t('vault.connect_wallet')}
          </button>
        )}
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        <div className="flex flex-col gap-1.5 mb-6">
          <h1 className="text-[16px] tracking-[0.25em] uppercase font-semibold text-gradient inline-flex items-center gap-2">
            <Inbox size={16} className="text-gold opacity-70" />
            {t('gift.inbox.external_title')}
          </h1>
          <p className="text-muted text-[11px] tracking-wide leading-relaxed max-w-xl">
            {t('gift.inbox.external_subtitle')}
          </p>
        </div>

        {connected ? (
          <InboxList />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <WalletGlyph size={30} className="text-muted opacity-40" strokeWidth={1.5} />
            <span className="text-text text-[12px] tracking-[0.12em]">{t('gift.inbox.connect_prompt')}</span>
            <button
              type="button"
              onClick={() => set_connect_open(true)}
              className="btn-gold px-6 py-2.5 text-[10px] tracking-[0.2em] uppercase inline-flex items-center gap-2 cursor-pointer"
            >
              <WalletGlyph size={12} /> {t('vault.connect_wallet')}
            </button>
          </div>
        )}
      </main>

      <WalletConnectModal open={connect_open} on_close={() => set_connect_open(false)} />
    </div>
  )
}
