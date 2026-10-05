// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Button } from '@aresrpg/ui'
import type { ReactNode, ComponentProps } from 'react'
import { Gift, Info, WalletCards } from 'lucide-react'

import './airdrop.css'
import { SuiLogo } from '../components/SuiLogo.tsx'
import { player_error_text } from '../i18n/player_error.ts'
import { WalletControl } from '../wallet/WalletControl.tsx'
import type { WalletView } from '../wallet/model.ts'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { env } from '../env.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { rolled_item_types } from '../modules/claims.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { group_giftcards, type GiftcardGroup } from './gift_rewards.ts'

type CampaignRow = (typeof content_catalog.airdrop.campaigns)[number]

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

export const HolderWalletConnect = ({
  wallet,
  copy,
  t,
}: Readonly<{ wallet: WalletView; copy: AppCopy; t: CopyText }>) => {
  const locked = useAppStore((state) => state.distribution.pending !== null && state.distribution.pending !== 'load')
  return (
    <section className="airdrop-holder">
      <WalletCards className="text-cyan" size={18} />
      <div>
        <div className="text-[9px] tracking-[0.2em] text-cyan uppercase">{t('holder_title')}</div>
        <div className="mt-1 max-w-md break-all font-mono text-[8px] leading-4 text-muted">
          {wallet.state.session?.address ?? t('holder_connect_hint')}
        </div>
      </div>
      <WalletControl wallet={wallet} copy={copy.kares_page} subtitle={t('holder_connect_hint')} locked={locked} />
    </section>
  )
}

export const CampaignCard = ({ row, t }: Readonly<{ row: CampaignRow; t: CopyText }>) => (
  <article className="aui-panel airdrop-campaign" data-airdrop={row.id}>
    <div className="airdrop-campaign-art">
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
    <div className="airdrop-campaign-copy">
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

export const AirdropCollection = ({
  copy,
  address,
  cards,
  busy,
  loaded,
  connected,
  gift_ready,
  error,
  wallet_control,
  refresh,
  claim,
  recover,
}: Readonly<{
  copy: AppCopy
  address: string | null
  cards: SessionState['giftcards']
  busy: string | null
  loaded: boolean
  connected: boolean
  gift_ready: boolean
  error: string | null
  wallet_control: ReactNode
  refresh: () => void
  claim: () => void
  recover: () => void
}>) => {
  const t = copy_text(copy.airdrop_page)
  return (
    <section className="aui-airdrop-collection">
      <div className="aui-panel airdrop-connect">{wallet_control}</div>
      <div className="aui-panel airdrop-claims">
        <header>
          <h2>{t('giftcards_title')}</h2>
          <p>
            {t('destination')} <code title={address ?? undefined}>{address ?? '—'}</code>
          </p>
        </header>
        <div className="aui-airdrop-vouchers">
          {group_giftcards(cards).map((giftcard) => (
            <GiftcardCard key={giftcard.template} giftcard={giftcard} />
          ))}
          {cards.length === 0 && <p>{t('empty')}</p>}
        </div>
        <div className="aui-airdrop-actions">
          <Button disabled={busy !== null || !connected} onClick={refresh}>
            {t('refresh')}
          </Button>
          <Button tone="primary" disabled={busy !== null || !loaded || cards.length === 0} onClick={claim}>
            {t('claim_all')}
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        {gift_ready && (
          <Button disabled={busy !== null} onClick={recover}>
            {t('gift_retry')}
          </Button>
        )}
      </div>
    </section>
  )
}

export default function AirdropPage({ copy, session }: Readonly<{ copy: AppCopy; session: SessionState }>) {
  const t = copy_text(copy.airdrop_page)
  const distribution = useAppStore((state) => state.distribution)
  const external_wallet = useAppStore((state) => state.external_wallet)
  const busy = distribution.pending
  const cards = [...(distribution.holder_giftcards ?? []), ...session.giftcards]

  return (
    <AirdropPageView
      copy={copy}
      collection={{
        address: session.wallet?.address ?? null,
        cards,
        busy,
        loaded: session.roster_loaded,
        connected: !!external_wallet.session,
        gift_ready: distribution.gift_link_ready,
        error: distribution.error ? player_error_text(copy, distribution.error) : null,
        wallet_control: (
          <HolderWalletConnect wallet={{ state: external_wallet, dispatch: dispatch_app }} copy={copy} t={t} />
        ),
        refresh: () => dispatch_app({ type: 'distribution/refresh_holder' }),
        claim: () => dispatch_app({ type: 'distribution/claim_all' }),
        recover: () => dispatch_app({ type: 'distribution/claim_gift_link' }),
      }}
    />
  )
}

export const AirdropPageView = ({
  copy,
  collection,
}: Readonly<{ copy: AppCopy; collection: Omit<ComponentProps<typeof AirdropCollection>, 'copy'> }>) => {
  const t = copy_text(copy.airdrop_page)
  return (
    <section className="airdrop-page">
      <header className="airdrop-intro">
        <details>
          <summary>
            <Info size={14} />
            {t('subtitle')}
          </summary>
          <p>{t('check_wallet')}</p>
        </details>
        <span className="airdrop-network">
          <SuiLogo size={14} />
          {env.network}
        </span>
      </header>
      <div className="airdrop-content">
        <AirdropCollection copy={copy} {...collection} />

        <section className="airdrop-catalogue">
          <h2>{t('catalogue_title')}</h2>
          <div className="aui-campaigns">
            {content_catalog.airdrop.campaigns.map((row) => (
              <CampaignCard key={row.id} row={row} t={t} />
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
