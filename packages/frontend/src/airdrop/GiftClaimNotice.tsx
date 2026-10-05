// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button } from '@aresrpg/ui'
import { MAX_GIFTCARDS_PER_TRANSACTION } from '@aresrpg/sdk/auth'
import { Gift, PackageCheck } from 'lucide-react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { content_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { rolled_item_types } from '../modules/claims.ts'
import type { DistributionState } from '../modules/distribution.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { gas_empty_error } from '../toast.ts'

import { group_giftcards, type GiftcardGroup } from './gift_rewards.ts'

const reward_item = ({ template }: GiftcardGroup) => {
  const item_type = rolled_item_types().get(template)
  return item_type ? content_catalog.item(item_type)?.item : null
}

export const gift_funding_text = (copy: AppCopy, distribution: DistributionState, session: SessionState): string => {
  const { notice, error } = distribution
  if (notice?.kind !== 'received' || !gas_empty_error(error)) return copy.out_of_sui_body
  const held = notice.giftcards.filter((card) => session.giftcards.some(({ id }) => id === card.id))
  if (!held.length) return copy.out_of_sui_body
  const t = copy_text(copy.airdrop_page)
  const rewards = group_giftcards(held)
    .map((card) => `${card.amount} × ${reward_item(card)?.name ?? t('reward_item')}`)
    .join(', ')
  return `${t('reward_received').replace('{items}', rewards)} ${t('reward_needs_sui')}`
}

const notice_status = (distribution: DistributionState, session: SessionState) => {
  if (distribution.notice?.kind !== 'received') return 'used'
  if (distribution.notice.giftcards.every(({ id }) => session.redeemed_giftcards.includes(id))) return 'complete'
  if (gas_empty_error(distribution.error)) return 'needs_sui'
  return distribution.pending === 'redeem' ? 'redeeming' : 'held'
}

const STATUS = {
  used: { title: 'reward_used_title', body: 'reward_used_body', actions: [] },
  complete: { title: 'reward_title', body: 'reward_complete', actions: [] },
  needs_sui: { title: 'reward_title', body: 'reward_needs_sui', actions: ['fund', 'redeem'] },
  redeeming: { title: 'reward_title', body: 'reward_redeeming', actions: ['redeem'] },
  held: { title: 'reward_title', body: 'reward_held', actions: ['redeem'] },
} as const

const GiftRewards = ({ cards, copy }: Readonly<{ cards: readonly GiftcardGroup[]; copy: AppCopy }>) => (
  <div className="flex max-h-64 flex-wrap justify-center gap-4 overflow-y-auto">
    {cards.map((card) => {
      const item = reward_item(card)
      const icon = item ? item_detail_icon(item.item_type) : null
      return (
        <figure className="flex w-36 flex-col items-center gap-2" key={card.template}>
          {icon && (
            <img className="size-28 object-contain drop-shadow-[0_0_24px_rgba(214,176,104,0.3)]" src={icon} alt="" />
          )}
          <figcaption className="text-sm font-semibold text-text">
            {card.amount} × {item?.name ?? copy_text(copy.airdrop_page)('reward_item')}
          </figcaption>
        </figure>
      )
    })}
  </div>
)

export const GiftClaimNoticeView = ({
  copy,
  distribution,
  session,
  close,
  fund,
  redeem,
}: Readonly<{
  copy: AppCopy
  distribution: DistributionState
  session: SessionState
  close: () => void
  fund: () => void
  redeem: () => void
}>) => {
  const { notice, error } = distribution
  const t = copy_text(copy.airdrop_page)
  if (!notice) return null
  const cards = notice.kind === 'received' ? group_giftcards(notice.giftcards) : []
  const status = STATUS[notice_status(distribution, session)]
  const actions = { fund: { label: copy.wallet_add_funds, run: fund }, redeem: { label: t('claim_all'), run: redeem } }
  return (
    <div className="flex flex-col items-center gap-5 p-6 text-center" data-gift-notice={notice.kind}>
      {notice.kind === 'unavailable' ? (
        <PackageCheck className="size-12 text-muted" />
      ) : (
        <Gift className="size-8 text-gold" />
      )}
      <h2 className="text-xl font-semibold text-gold">{t(status.title)}</h2>
      <GiftRewards cards={cards} copy={copy} />
      <p className="text-sm leading-relaxed text-muted" role="status">
        {t(status.body)}
      </p>
      {error && (
        <p className="text-xs text-gold" role="alert">
          {player_error_text(copy, error)}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {status.actions.map((action) => (
          <Button key={action} tone="primary" disabled={distribution.pending !== null} onClick={actions[action].run}>
            {actions[action].label}
          </Button>
        ))}
        <Button onClick={close}>{t('reward_continue')}</Button>
      </div>
    </div>
  )
}

export const GiftClaimNotice = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const distribution = useAppStore((state) => state.distribution)
  const session = useAppStore((state) => state.session)
  const dialog = useAppStore((state) => state.navigation.dialog)
  const { notice } = distribution
  if (!session.wallet || !notice || dialog === 'top_up') return null
  const close = (): void => dispatch_app({ type: 'distribution/notice_dismissed' })
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={copy_text(copy.airdrop_page)('title')}>
      <GiftClaimNoticeView
        copy={copy}
        distribution={distribution}
        session={session}
        close={close}
        fund={() => dispatch_app({ type: 'dialog/open', dialog: 'top_up' })}
        redeem={() => {
          if (notice.kind === 'received')
            dispatch_app({
              type: 'distribution/redeem',
              giftcards: notice.giftcards
                .filter((card) => session.giftcards.some(({ id }) => id === card.id))
                .slice(0, MAX_GIFTCARDS_PER_TRANSACTION),
            })
        }}
      />
    </ModalFrame>
  )
}
