// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Gift, Loader2, Sparkles, WalletCards } from 'lucide-react'

import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { rolled_item_types } from '../modules/claims.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

type CampaignRow = (typeof content_catalog.airdrop.campaigns)[number]
type GiftcardGroup = Readonly<{ template: string; amount: number }>

export const group_giftcards = (cards: SessionState['giftcards']): readonly GiftcardGroup[] =>
  Object.values(
    [...new Map(cards.map((card) => [card.id, card])).values()].reduce<Record<string, GiftcardGroup>>(
      (groups, card) => ({
        ...groups,
        [card.template]: { template: card.template, amount: (groups[card.template]?.amount ?? 0) + card.amount },
      }),
      {}
    )
  )

const giftcard_item = (giftcard: GiftcardGroup) => {
  const item_type = rolled_item_types().get(giftcard.template)
  return item_type ? content_catalog.item(item_type)?.item : null
}

const GiftcardCard = ({ giftcard }: Readonly<{ giftcard: GiftcardGroup }>) => {
  const item = giftcard_item(giftcard)
  const icon = item ? item_detail_icon(item.item_type) : null
  return (
    <article className="flex items-center gap-3 border border-border bg-surface/80 p-4">
      {icon && <img alt="" className="size-14 object-contain" src={icon} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs tracking-[0.12em] text-text uppercase">{item?.name ?? giftcard.template}</div>
        <div className="mt-2 text-sm text-gold">×{giftcard.amount}</div>
      </div>
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
}: Readonly<{ wallet: WalletView; copy: AppCopy; t: CopyText }>) => {
  const locked = useAppStore((state) => state.distribution.pending !== null && state.distribution.pending !== 'load')
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 border border-cyan/20 bg-[radial-gradient(circle_at_50%_0%,rgba(72,207,207,0.08),transparent_70%)] px-5 py-5 text-center">
      <WalletCards className="text-cyan" size={18} />
      <div>
        <div className="text-[9px] tracking-[0.2em] text-cyan uppercase">{t('holder_title')}</div>
        <div className="mt-1 max-w-md font-mono text-[8px] leading-4 text-muted">
          {wallet.state.session?.address ?? t('holder_connect_hint')}
        </div>
      </div>
      <WalletControl wallet={wallet} copy={copy.kares_page} subtitle={t('holder_connect_hint')} locked={locked} />
    </section>
  )
}

const CampaignCard = ({ row, t }: Readonly<{ row: CampaignRow; t: CopyText }>) => (
  <article className="flex flex-col border border-border bg-surface-low" data-airdrop={row.id}>
    <div className="flex min-h-44 flex-wrap items-center justify-center gap-2 border-b border-border/60 p-4">
      {row.items.map((item_type) => (
        <figure className="flex flex-col items-center gap-1" key={item_type}>
          <img
            alt=""
            className={row.items.length === 1 ? 'size-36 object-contain' : 'size-20 object-contain'}
            src={item_detail_icon(item_type) ?? undefined}
          />
          {row.items.length > 1 && (
            <figcaption className="text-[9px] text-muted">{content_catalog.item(item_type)?.item.name}</figcaption>
          )}
        </figure>
      ))}
    </div>
    <div className="flex flex-1 flex-col gap-3 p-4">
      <span className="text-[9px] tracking-[0.16em] text-cyan uppercase">{t(`delivery.${row.delivery}`)}</span>
      <h2 className="text-sm font-semibold tracking-[0.1em] text-text uppercase">{t(`campaigns.${row.id}.title`)}</h2>
      <p className="text-xs leading-5 text-muted">
        {t(`campaigns.${row.id}.description`).replace('{threshold}', String(row.spending_threshold_sui ?? ''))}
      </p>
      {row.tiers && (
        <ul className="space-y-1 border-t border-border pt-3 text-xs text-gold">
          {row.tiers.map((tier) => (
            <li key={tier.from}>
              {t('rank_reward')
                .replace('{from}', String(tier.from))
                .replace('{to}', String(tier.to))
                .replace('{amount}', String(tier.amount))}
            </li>
          ))}
        </ul>
      )}
    </div>
  </article>
)

export default function AirdropPage({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) {
  const t = copy_text(copy.airdrop_page)
  const distribution = useAppStore((state) => state.distribution)
  const external_wallet = useAppStore((state) => state.external_wallet)
  const busy = distribution.pending
  const cards = [...(distribution.holder_giftcards ?? []), ...session.giftcards]

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
        <p className="mx-auto w-full max-w-3xl text-sm leading-6 text-muted">{t('check_wallet')}</p>
        <GiftLinkClaim busy={busy} ready={distribution.gift_link_ready} t={t} />
        <HolderWalletConnect wallet={{ state: external_wallet, dispatch: dispatch_app }} copy={copy} t={t} />

        {distribution.error && (
          <p role="alert" className="text-sm text-red-400">
            {distribution.error}
          </p>
        )}
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs tracking-[0.16em] text-cyan uppercase">{t('giftcards_title')}</h2>
            <button
              className="btn-outline px-3 py-2 text-xs disabled:opacity-40"
              disabled={busy !== null || !external_wallet.session}
              onClick={() => dispatch_app({ type: 'distribution/refresh_holder' })}
              type="button"
            >
              {t('refresh')}
            </button>
          </div>
          <p className="break-all text-xs text-muted">
            {t('destination')} {session.wallet?.address}
          </p>
          {cards.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {group_giftcards(cards).map((giftcard) => (
                  <GiftcardCard giftcard={giftcard} key={giftcard.template} />
                ))}
              </div>
              <button
                className="btn-gold inline-flex items-center gap-2 self-end px-5 py-3 text-xs tracking-[0.12em] uppercase disabled:opacity-40"
                disabled={busy !== null || !session.roster_loaded}
                onClick={() => dispatch_app({ type: 'distribution/claim_all' })}
                type="button"
              >
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Gift size={14} />}
                {t('claim_all')}
              </button>
            </>
          ) : (
            <p className="text-xs text-muted">{t('empty')}</p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3 border-b border-border/60 pb-2">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.28em] text-gold uppercase">
              <Sparkles className="opacity-70" size={12} /> {t('catalogue_title')}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4">
            {content_catalog.airdrop.campaigns.map((row) => (
              <CampaignCard key={row.id} row={row} t={t} />
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
