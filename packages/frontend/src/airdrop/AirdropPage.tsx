// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button, SuiLogo } from '@aresrpg/ui'
import { useEffect, type ReactNode, type ComponentProps } from 'react'
import { Gift, Info, WalletCards } from 'lucide-react'

import { sui_session } from '../wallet/external_session.ts'
import { external_wallet_view } from '../wallet/view.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'
import { public_airdrop_campaigns, type AirdropCampaign } from '../content/airdrop.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { items_by_type } from '../content/items.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { rolled_item_types } from '../content/item_templates.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useSiteStore } from '../store.ts'

import { group_giftcards, type GiftcardGroup } from './gift_rewards.ts'

type CampaignRow = AirdropCampaign

/** The collection's two panels: the holder wallet beside the giftcards waiting for redemption. */
const PANEL = 'aui-panel bg-surface-high p-3'
/** A campaign's art and copy text sizes, as the authored campaigns are written. */
const CAMPAIGN_LINE = 'font-ui text-[11px]/[1.45] text-soft'

const giftcard_item = (giftcard: GiftcardGroup) => {
  const item_type = rolled_item_types().get(giftcard.template)
  return item_type ? items_by_type[item_type] : null
}

const GiftcardCard = ({ giftcard }: Readonly<{ giftcard: GiftcardGroup }>) => {
  const item = giftcard_item(giftcard)
  const icon = item ? item_detail_icon(item.item_type) : null
  return (
    <article className="flex items-center gap-1.5 rounded-[5px] border border-border bg-surface/80 p-1.5">
      {icon && <img alt="" className="size-8 object-contain" src={icon} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs tracking-[0.12em] text-text uppercase">{item?.name ?? giftcard.template}</div>
        <div className="mt-2 text-sm text-gold">×{giftcard.amount}</div>
      </div>
    </article>
  )
}

const HolderWalletConnect = ({ wallet, copy, t }: Readonly<{ wallet: WalletView; copy: AppCopy; t: CopyText }>) => {
  const locked = useSiteStore((state) => state.distribution.pending !== null && state.distribution.pending !== 'load')
  return (
    <section className="grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 @max-[1000px]/aui-window:grid-cols-[24px_minmax(0,1fr)] @max-[650px]/aui-window:grid-cols-[24px_minmax(0,1fr)_auto] [&_.aui-button]:min-h-9.5 [&_.aui-button]:whitespace-nowrap [&_[data-wallet-menu]]:justify-self-end @max-[1000px]/aui-window:[&_[data-wallet-menu]]:col-span-full @max-[1000px]/aui-window:[&_[data-wallet-menu]]:justify-self-stretch @max-[650px]/aui-window:[&_[data-wallet-menu]]:col-auto">
      <WalletCards className="text-cyan" size={18} />
      <div className="min-w-0">
        <div className="font-ui text-[12px] leading-[normal] font-semibold text-gold">{t('holder_title')}</div>
        <div className="mt-1 max-w-md font-ui text-[10px]/[1.4] font-normal break-all wrap-anywhere text-muted">
          {wallet.state.session?.address ?? t('holder_connect_hint')}
        </div>
      </div>
      <WalletControl wallet={wallet} copy={copy.kares_page} subtitle={t('holder_connect_hint')} locked={locked} />
    </section>
  )
}

const CampaignCard = ({ row, t }: Readonly<{ row: CampaignRow; t: CopyText }>) => (
  <article
    className="aui-panel grid min-h-0 min-w-0 grid-cols-[88px_minmax(0,1fr)] overflow-hidden border-steel/[26.7%] bg-surface-high p-0 @max-[1000px]/aui-window:grid-cols-[68px_minmax(0,1fr)]"
    data-airdrop={row.id}
  >
    <div
      className={`flex h-full min-h-0 flex-wrap items-center justify-center p-2 ${row.items.length > 1 ? 'content-center gap-1' : 'gap-[7px]'}`}
    >
      {row.items.map((item_type) => (
        <figure
          className={`flex max-w-[90px] flex-col items-center gap-1 ${row.items.length > 1 ? 'w-[30px]' : ''}`}
          key={item_type}
        >
          <img
            alt=""
            className={`object-contain ${row.items.length > 1 ? 'size-[30px]' : 'size-18 @max-[1000px]/aui-window:size-13'}`}
            src={item_detail_icon(item_type) ?? undefined}
          />
          <figcaption className="text-center text-[8px] text-muted">{items_by_type[item_type]?.name}</figcaption>
        </figure>
      ))}
    </div>
    <div className="flex min-h-0 flex-col gap-[7px] overflow-y-auto py-3 pr-2.5 [scrollbar-width:thin]">
      <span className="text-[10px] text-[#8eb7cb]">{t(`delivery.${row.delivery}`)}</span>
      <h2 className="font-ui text-sm/[1.3] font-bold tracking-normal text-gold">{t(`campaigns.${row.id}.title`)}</h2>
      <p className={CAMPAIGN_LINE}>
        {t(`campaigns.${row.id}.description`).replace('{threshold}', String(row.spending_threshold_sui ?? ''))}
      </p>
      {row.tiers && (
        <ul className="border-t border-border pt-1.5">
          {row.tiers.map((tier) => (
            <li className={CAMPAIGN_LINE} key={tier.from}>
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

const AirdropCollection = ({
  copy,
  address,
  cards,
  busy,
  loaded,
  connected,
  wallet_control,
  refresh,
  claim,
}: Readonly<{
  copy: AppCopy
  address: string | null
  cards: SessionState['giftcards']
  busy: string | null
  loaded: boolean
  connected: boolean
  wallet_control: ReactNode
  refresh: () => void
  claim: () => void
}>) => {
  const t = copy_text(copy.airdrop_page)
  return (
    <section className="grid flex-none grid-cols-[minmax(260px,0.85fr)_minmax(0,1.65fr)] gap-2.5 @max-[1000px]/aui-window:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.2fr)] @max-[650px]/aui-window:grid-cols-1">
      <div className={`${PANEL} flex min-w-0 items-center`}>{wallet_control}</div>
      <div
        className={`${PANEL} grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 @max-[1000px]/aui-window:grid-cols-1`}
      >
        <header className="min-w-0">
          <h2 className="text-[12px] text-soft">{t('giftcards_title')}</h2>
          <p className="mt-[3px] flex items-center gap-[5px] text-[10px] text-muted">
            {t('destination')}{' '}
            <code className="max-w-[230px] truncate text-gold" title={address ?? undefined}>
              {address ?? '—'}
            </code>
          </p>
        </header>
        {/* Until the account's cards are read, one card's box holds their place. */}
        <div className="col-1 flex min-w-0 flex-wrap gap-1.5">
          {group_giftcards(cards).map((giftcard) => (
            <GiftcardCard key={giftcard.template} giftcard={giftcard} />
          ))}
          {cards.length === 0 &&
            (loaded ? (
              <p className="mt-[3px] text-[10px] text-muted">{t('empty')}</p>
            ) : (
              <span className="aui-skeleton aui-skeleton--block w-45" aria-hidden="true" />
            ))}
        </div>
        <div className="col-2 row-[1/span_2] flex gap-1.5 @max-[1000px]/aui-window:col-1 @max-[1000px]/aui-window:row-auto">
          <Button className="min-h-9.5" disabled={busy !== null || !connected} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button
            className="min-h-9.5"
            tone="primary"
            disabled={busy !== null || !loaded || cards.length === 0}
            onClick={claim}
          >
            {t('claim_all')}
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function AirdropPage({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) {
  const t = copy_text(copy.airdrop_page)
  const distribution = useSiteStore((state) => state.distribution)
  const external_wallet = useSiteStore((state) => state.external_wallet)
  const busy = distribution.pending
  const cards = [...(distribution.holder_giftcards ?? []), ...session.giftcards]
  const wallet_control = <HolderWalletConnect wallet={external_wallet_view(external_wallet)} copy={copy} t={t} />
  // The view says when it is on screen; the holder read and the automatic redemption follow it. Its
  // failures are toasts from the distribution module.
  useEffect(() => {
    dispatch_app({ type: 'distribution/viewed', open: true })
    return () => dispatch_app({ type: 'distribution/viewed', open: false })
  }, [])

  return (
    <AirdropPageView
      copy={copy}
      collection={{
        address: session.wallet?.address ?? null,
        cards,
        busy,
        loaded: session.roster_loaded,
        connected: !!sui_session(external_wallet.session),
        wallet_control,
        refresh: () => dispatch_app({ type: 'distribution/refresh_holder' }),
        claim: () => dispatch_app({ type: 'distribution/claim_all' }),
      }}
    />
  )
}

const AirdropPageView = ({
  copy,
  collection,
}: Readonly<{
  copy: AppCopy
  collection: Omit<ComponentProps<typeof AirdropCollection>, 'copy'>
}>) => {
  const t = copy_text(copy.airdrop_page)
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
      <header className="flex flex-none items-start justify-between gap-3">
        <details className="min-w-0 flex-1 text-[11px] text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-[7px] text-gold">
            <Info size={14} />
            {t('subtitle')}
          </summary>
          <p className="mt-2 max-w-[105ch] leading-normal">{t('check_wallet')}</p>
        </details>
        <span className="flex items-center gap-[5px] text-[10px] text-cyan">
          <SuiLogo size={14} />
          {env.network}
        </span>
      </header>
      <div className="block min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <AirdropCollection copy={copy} {...collection} />

        <section className="mt-3 flex flex-col gap-2">
          <h2 className="flex-none text-[12px] text-gold">{t('catalogue_title')}</h2>
          <div className="grid min-h-0 auto-rows-[190px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] content-start gap-2.5 overflow-visible @max-[1000px]/aui-window:grid-cols-3 @max-[650px]/aui-window:grid-cols-2 @max-[480px]/aui-window:auto-rows-auto @max-[480px]/aui-window:grid-cols-1">
            {public_airdrop_campaigns.map((row) => (
              <CampaignCard key={row.id} row={row} t={t} />
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
