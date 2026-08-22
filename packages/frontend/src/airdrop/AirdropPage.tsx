// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Cat, Check, Crown, Gift, Loader2, Lock, Shirt, Sparkles, Star, type LucideIcon } from 'lucide-react'
import { useState } from 'react'

import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import type { SessionState } from '../modules/session.ts'
import { stack_merge_target_row } from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'

const glyphs: Readonly<Record<string, LucideIcon>> = Object.freeze({
  pet_glb: Cat,
  cosmetic: Crown,
  title_relic: Star,
  outfit: Shirt,
})

type ShowcaseRow = (typeof content_catalog.airdrop.showcase)[number]

const ShowcaseTile = ({ row, t }: Readonly<{ row: ShowcaseRow; t: CopyText }>) => {
  const Glyph = glyphs[row.kind] ?? Sparkles
  const icon = item_detail_icon(row.id)
  return (
    <article className="flex flex-col border border-border bg-black/40">
      <div className="flex aspect-[5/4] flex-col items-center justify-center gap-2 border-b border-border/60 bg-[radial-gradient(circle_at_50%_35%,rgba(200,150,60,0.07),transparent_70%)]">
        {icon ? (
          <img alt="" className="size-[78%] object-contain" src={icon} />
        ) : (
          <>
            <Glyph className="text-gold/25" size={34} />
            <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t('set.no_preview')}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-2.5">
        <span className="truncate text-[11px] font-semibold tracking-[0.12em] text-text uppercase">{row.name}</span>
        <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t(`set.kind.${row.kind}`)}</span>
        {'aura' in row && row.aura && (
          <span className="inline-flex items-center gap-1.5 text-[8px] tracking-[0.16em] text-cyan-300/80 uppercase">
            <i className="size-1 bg-cyan-300 shadow-[0_0_5px_rgba(103,232,249,0.7)]" />
            {t('set.aura')} · {row.aura.color}
          </span>
        )}
        {'aura_pending' in row && row.aura_pending && (
          <span className="text-[8px] tracking-[0.18em] text-muted/60 uppercase">{t('set.aura_pending')}</span>
        )}
      </div>
    </article>
  )
}

export default function AirdropPage({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) {
  const t = copy_text(copy.airdrop_page)
  const [busy, set_busy] = useState<string | null>(null)
  const address = session.wallet?.address ?? null
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)

  const claim = (drop: (typeof content_catalog.airdrop.drops)[number]): void => {
    const { wallet } = session
    if (!wallet || busy || !drop.item) return
    set_busy(drop.id)
    const pending = toast.loading(t('pending_claim'))
    const existing = stack_merge_target_row(session.inventory, listings, drop.item_type)
    void wallet
      .claim_airdrop({
        drop_id: drop.id,
        item_type: drop.item_type,
        category: drop.item.category,
        existing_item_id: existing?.id ?? null,
        existing_kiosk_id: existing?.kiosk ?? null,
      })
      .then(() => {
        dispatch_app({ type: 'airdrop/claimed', drop_id: drop.id })
        pending.success(t('toast_claimed'))
        dispatch_app({ type: 'wallet/refresh' })
      })
      .catch(pending.error)
      .finally(() => set_busy(null))
  }

  return (
    <section className="pointer-events-auto flex min-h-full flex-1 flex-col overflow-hidden border border-border bg-[#0a0a0f]/97">
      <header className="flex shrink-0 items-end justify-between gap-4 border-b border-border px-6 pt-4 pb-3">
        <div className="flex min-w-0 items-baseline gap-3.5">
          <h1 className="inline-flex items-center gap-2 bg-[linear-gradient(135deg,#f5d0a9,#c8963c,#f0c474)] bg-clip-text text-[12px] font-semibold tracking-[0.3em] text-transparent uppercase">
            <Sparkles className="text-gold opacity-70" size={14} /> {t('title')}
          </h1>
          <span className="truncate text-[9px] tracking-[0.14em] text-muted/85 uppercase">{t('subtitle')}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[8px] tracking-[0.18em] text-muted uppercase">
          <i className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]" />
          Sui · {env.network}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        {content_catalog.airdrop.drops.length === 0 ? (
          <div className="flex items-center gap-2.5 border border-border/60 px-3 py-2.5 text-muted">
            <Gift className="opacity-40" size={13} />
            <span className="text-[9px] tracking-[0.18em] uppercase">{t('empty')}</span>
            <span className="truncate text-[9px] tracking-[0.08em] text-muted/60">{t('empty_hint')}</span>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {content_catalog.airdrop.drops.map((drop) => {
              const state = session.shop?.airdrops.find(({ drop_id }) => drop_id === drop.id)
              const eligible = !!address && state?.eligible === true
              return (
                <article className="flex flex-col gap-3 border border-border bg-surface/80 p-4" key={drop.id}>
                  <div className="flex items-center gap-3">
                    {drop.item && item_detail_icon(drop.item.item_type) && (
                      <img alt="" className="size-14 object-contain" src={item_detail_icon(drop.item.item_type)!} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold tracking-[0.12em] text-text uppercase">
                        {drop.id.replaceAll('_', ' ')}
                      </div>
                      <div className="mt-1 truncate text-[9px] tracking-[0.1em] text-muted uppercase">
                        {drop.item?.name ?? drop.item_type}
                      </div>
                    </div>
                  </div>
                  <div className="text-[8px] tracking-[0.14em] text-muted/60 uppercase">
                    {t('eligible_count', { count: state?.eligible_count ?? 0 })}
                  </div>
                  <div>
                    <span
                      className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[9px] tracking-[0.15em] uppercase ${eligible ? 'border-emerald-400/30 text-emerald-400' : 'border-border text-muted'}`}
                    >
                      {eligible ? <Check size={10} /> : <Lock size={10} />}
                      {t(eligible ? 'eligible' : 'not_eligible')}
                    </span>
                  </div>
                  <button
                    className="btn-gold inline-flex w-full cursor-pointer items-center justify-center gap-2 py-2.5 text-[10px] tracking-[0.2em] disabled:cursor-not-allowed"
                    disabled={!eligible || busy !== null}
                    onClick={() => claim(drop)}
                    type="button"
                  >
                    {busy === drop.id ? <Loader2 className="animate-spin" size={11} /> : <Gift size={12} />}{' '}
                    {t('claim')}
                  </button>
                </article>
              )
            })}
          </div>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border/60 pb-2">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.28em] text-gold uppercase">
              <Sparkles className="opacity-70" size={12} /> {t('set.title')}
            </span>
            <span className="truncate text-[9px] tracking-[0.14em] text-muted/70 uppercase">{t('set.subtitle')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {content_catalog.airdrop.showcase.map((row) => (
              <ShowcaseTile key={row.id} row={row} t={t} />
            ))}
            {content_catalog.airdrop.pending.map((row) => (
              <article className="flex flex-col border border-dashed border-border bg-black/20 opacity-70" key={row.id}>
                <div className="grid aspect-[5/4] place-items-center border-b border-border/60">
                  <Sparkles className="text-muted/20" size={22} />
                </div>
                <div className="p-2.5">
                  <div className="truncate text-[11px] tracking-[0.12em] text-muted uppercase">{row.name}</div>
                  <div className="mt-1 text-[8px] tracking-[0.18em] text-muted/60 uppercase">
                    {t('set.awaiting_ruling')}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
