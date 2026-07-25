// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Gift, Sparkles, Check, Lock } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { use_auth } from '../auth'
import { use_airdrops } from '../stores/airdrop'
import type { RpcAirdrop } from '../rpc/views'
import { ItemImage } from '../components/items'
import { cosmetic_icon_of } from '../game/cosmetic_icons.js'

import { AirdropShowcase } from './airdrop_showcase'

// AIRDROP — the whitelist claim-MINT sidebar page. A shop-card-like grid of
// reserved-item drops; each shows whether the CONNECTED identity (zkLogin address + optional external wallet) is
// on that drop's whitelist, and a claim that mints ONE into the claimer's own kiosk (mint-lock, no royalty) and
// removes the address. The whitelist CONTENT lands "way later" — so the honest empty state is the default.

const NETWORK = ((import.meta as unknown as { env: Record<string, string> }).env?.VITE_NETWORK || 'testnet').trim()

function AirdropCard({
  airdrop,
  eligible,
  busy,
  on_claim,
}: {
  airdrop: RpcAirdrop
  eligible: boolean
  busy: boolean
  on_claim: (a: RpcAirdrop) => void
}) {
  const { t } = useTranslation()
  const claimed = airdrop.eligible_for.length === 0 && !eligible // whitelist emptied for us after a claim
  return (
    <div className="glass-panel flex flex-col gap-3 p-4 border border-border">
      <div className="flex items-center gap-3">
        <ItemImage
          id={
            cosmetic_icon_of({ slug: slugs[airdrop.item.name], name: airdrop.item.name }) ??
            slugs[airdrop.item.name] ??
            ''
          }
          appearance={airdrop.item.appearance}
          category="cosmetic"
          className="w-14 h-14 shrink-0 border border-gold/20"
        />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-text text-[12px] tracking-[0.12em] uppercase font-semibold truncate">
            {airdrop.name}
          </span>
          <span className="text-muted text-[9px] tracking-[0.1em] uppercase truncate">{airdrop.item.name}</span>
        </div>
      </div>

      {airdrop.description && (
        <p className="text-muted/80 text-[10px] tracking-wide leading-relaxed">{airdrop.description}</p>
      )}

      <div className="flex items-center gap-2 text-[8px] tracking-[0.14em] uppercase text-muted/60">
        <span>{t('airdrop.minted', { count: airdrop.minted })}</span>
        <span className="opacity-40">·</span>
        <span>{t('airdrop.eligible_count', { count: airdrop.eligible_count })}</span>
      </div>

      {/* Eligibility badge */}
      <div className="flex items-center gap-1.5">
        {eligible ? (
          <span className="inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-emerald-400 border border-emerald-400/30 px-2 py-0.5">
            <Check size={10} /> {t('airdrop.eligible')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-muted border border-border px-2 py-0.5">
            <Lock size={10} /> {t(claimed ? 'airdrop.claimed' : 'airdrop.not_eligible')}
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={!eligible || busy}
        onClick={() => on_claim(airdrop)}
        className="btn-gold w-full py-2.5 text-[10px] tracking-[0.2em] uppercase inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Gift size={12} />}
        {t('airdrop.claim')}
      </button>
    </div>
  )
}

export function AirdropPage() {
  const { t } = useTranslation()
  const address = use_auth((s) => s.address)
  const { airdrops, loading, loaded_once, busy_id, load, claim } = use_airdrops()

  useEffect(() => {
    if (!address) return
    let alive = true
    const run = () => alive && load([address])
    run()
    const iv = setInterval(run, 30000)
    const on_focus = () => run()
    window.addEventListener('focus', on_focus)
    return () => {
      alive = false
      clearInterval(iv)
      window.removeEventListener('focus', on_focus)
    }
  }, [address, load])

  return (
    <div className="app-page flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Masthead — mirrors the marketplace edge-to-edge operator screen */}
      <div className="app-page-header flex items-end justify-between gap-4 px-6 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-baseline gap-3.5 min-w-0">
          <span className="app-page-title text-[12px] tracking-[0.3em] uppercase font-semibold text-gradient inline-flex items-center gap-2">
            <Sparkles size={14} className="text-gold opacity-70" />
            {t('airdrop.title')}
          </span>
          <span className="app-page-subtitle text-[9px] tracking-[0.14em] uppercase text-muted/85 truncate">
            {t('airdrop.subtitle')}
          </span>
        </div>
        <span className="app-page-status flex items-center gap-2 text-[8px] tracking-[0.18em] uppercase text-muted shrink-0">
          <i
            className="w-1.5 h-1.5 rounded-full bg-emerald-400"
            style={{ boxShadow: '0 0 6px rgba(52,211,153,0.55)' }}
          />
          Sui &middot; {NETWORK}
        </span>
      </div>

      {/* The CLAIM half (chain state) sits above the SET half (published showcase data, #803): what you can
          take now, then what the set is. With no live drop the claim half collapses to one honest line — the
          page is no longer empty, so it must not read as if it were. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 flex flex-col gap-6">
        {loading && !loaded_once ? (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 size={14} className="animate-spin text-gold opacity-40" />
            <span className="text-muted text-[10px] tracking-[0.2em] uppercase animate-pulse">
              {t('common.loading')}
            </span>
          </div>
        ) : airdrops.length === 0 ? (
          <div className="flex items-center gap-2.5 text-muted border border-border/60 px-3 py-2.5">
            <Gift size={13} style={{ opacity: 0.4 }} />
            <span className="text-[9px] tracking-[0.18em] uppercase">{t('airdrop.empty')}</span>
            <span className="text-[9px] tracking-[0.08em] text-muted/60 truncate">{t('airdrop.empty_hint')}</span>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {airdrops.map((a) => (
              <AirdropCard
                key={a.airdrop_id}
                airdrop={a}
                eligible={a.eligible_for.length > 0}
                busy={busy_id === a.airdrop_id}
                on_claim={claim}
              />
            ))}
          </div>
        )}

        <AirdropShowcase />
      </div>
    </div>
  )
}
