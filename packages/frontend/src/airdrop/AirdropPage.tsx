// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Cat, Gift, Loader2, Shirt, Sparkles, Star, WalletCards, type LucideIcon } from 'lucide-react'

import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { rolled_item_types } from '../modules/claims.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

const glyphs: Readonly<Record<string, LucideIcon>> = Object.freeze({
  pet_glb: Cat,
  title_relic: Star,
  outfit: Shirt,
})

type ShowcaseRow = (typeof content_catalog.airdrop.showcase)[number]
const giftcard_item = (giftcard: SessionState['giftcards'][number]) => {
  const item_type = rolled_item_types().get(giftcard.template)
  return item_type ? content_catalog.item(item_type)?.item : null
}

const GiftcardCard = ({
  busy,
  giftcard,
  external = false,
  t,
}: Readonly<{ busy: string | null; giftcard: SessionState['giftcards'][number]; external?: boolean; t: CopyText }>) => {
  const item = giftcard_item(giftcard)
  const icon = item ? item_detail_icon(item.item_type) : null
  return (
    <article className="flex items-center gap-3 border border-border bg-surface/80 p-3">
      {icon && <img alt="" className="size-12 object-contain" src={icon} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] tracking-[0.12em] text-text uppercase">
          {item?.name ?? giftcard.template}
        </div>
        <div className="mt-1 text-[8px] text-muted">×{giftcard.amount}</div>
      </div>
      <button
        className="btn-gold px-3 py-2 text-[8px] tracking-[0.14em] uppercase disabled:opacity-40"
        disabled={busy !== null || !item}
        onClick={() => dispatch_app({ type: external ? 'distribution/import' : 'distribution/redeem', giftcard })}
        type="button"
      >
        {busy === `redeem:${giftcard.id}` ? (
          <Loader2 className="animate-spin" size={11} />
        ) : (
          t(external ? 'claim' : 'redeem')
        )}
      </button>
    </article>
  )
}

const GiftLinkClaim = ({ ready, busy, t }: Readonly<{ ready: boolean; busy: string | null; t: CopyText }>) => {
  if (!ready) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border border-gold/30 bg-gold/5 p-3">
      <Gift className="text-gold" size={15} />
      <div className="mr-auto text-[9px] tracking-[0.14em] text-gold uppercase">
        {t(busy === 'gift-link' ? 'gift_claiming' : 'gift_ready')}
      </div>
      <button
        className="btn-gold px-3 py-2 text-[8px] tracking-[0.14em] uppercase disabled:opacity-40"
        disabled={busy !== null}
        onClick={() => dispatch_app({ type: 'distribution/claim_gift_link' })}
        type="button"
      >
        {busy === 'gift-link' ? <Loader2 className="animate-spin" size={11} /> : t('gift_retry')}
      </button>
    </div>
  )
}

export const HolderWalletConnect = ({
  wallet,
  copy,
  t,
}: Readonly<{ wallet: WalletView; copy: AppCopy; t: CopyText }>) => (
  <section className="flex flex-col items-center gap-3 border border-cyan/20 bg-[radial-gradient(circle_at_50%_0%,rgba(72,207,207,0.08),transparent_70%)] px-5 py-5 text-center">
    <WalletCards className="text-cyan" size={18} />
    <div>
      <div className="text-[9px] tracking-[0.2em] text-cyan uppercase">{t('holder_title')}</div>
      <div className="mt-1 max-w-md font-mono text-[8px] leading-4 text-muted">
        {wallet.state.session?.address ?? t('holder_connect_hint')}
      </div>
    </div>
    <WalletControl wallet={wallet} copy={copy.kares_page} subtitle={t('holder_connect_hint')} />
  </section>
)

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
  const distribution = useAppStore((state) => state.distribution)
  const external_wallet = useAppStore((state) => state.external_wallet)
  const busy = distribution.pending

  return (
    <section className="pointer-events-auto flex min-h-full flex-1 flex-col overflow-hidden border border-border bg-bg/97">
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
        <GiftLinkClaim busy={busy} ready={distribution.gift_link_ready} t={t} />
        <HolderWalletConnect wallet={{ state: external_wallet, dispatch: dispatch_app }} copy={copy} t={t} />

        {distribution.error && (
          <p role="alert" className="text-sm text-red-400">
            {distribution.error}
          </p>
        )}
        {external_wallet.session && (
          <section className="flex flex-col gap-3">
            <button
              className="btn-gold self-start px-3 py-2 text-xs"
              disabled={busy !== null}
              onClick={() => dispatch_app({ type: 'distribution/refresh_holder' })}
              type="button"
            >
              {t('refresh')}
            </button>
            <div className="break-all text-xs text-muted">
              {t('destination')} {session.wallet?.address}
            </div>
            {distribution.holder_giftcards?.length === 0 && <p className="text-xs text-muted">{t('empty')}</p>}
            {distribution.holder_giftcards?.map((giftcard) => (
              <GiftcardCard busy={busy} external giftcard={giftcard} key={giftcard.id} t={t} />
            ))}
          </section>
        )}

        {session.giftcards.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="border-b border-border/60 pb-2 text-[10px] font-semibold tracking-[0.24em] text-cyan uppercase">
              {t('giftcards_title')}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {session.giftcards.map((giftcard) => (
                <GiftcardCard busy={busy} giftcard={giftcard} key={giftcard.id} t={t} />
              ))}
            </div>
          </section>
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
