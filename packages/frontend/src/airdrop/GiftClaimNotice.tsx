// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The gift window and the giftcard cells. The window opens by itself on every surface of a signed-in account while
// giftcards wait (`gift_window_open`), until the visitor closes it in this browser session; the airdrop section lists
// the same cells for whoever closed it. Both redeem through the one `distribution/redeem`.
import { Button, active_modal, observe_window_changes } from '@aresrpg/ui'
import type { GiftcardRow } from '@aresrpg/protocol'
import { MAX_GIFTCARDS_PER_TRANSACTION } from '@aresrpg/sdk/giftcard-batch'
import { Gift } from 'lucide-react'
import { useLayoutEffect, useState } from 'react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { items_by_type } from '../content/items.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import { rolled_item_types } from '../content/item_templates.ts'
import { gift_window_open, gift_window_status, type DistributionState } from '../modules/distribution.ts'
import type { SessionState } from '../modules/session.ts'
import { dispatch_app, useSiteStore } from '../store.ts'
import { gas_empty_error } from '../toast.ts'

import { group_giftcards, type GiftcardGroup } from './gift_rewards.ts'

const reward_item = ({ template }: GiftcardGroup) => {
  const item_type = rolled_item_types().get(template)
  return item_type ? items_by_type[item_type] : null
}

/** The funding window's line while giftcards wait and their claim ran out of SUI. */
export const gift_funding_text = (
  copy: AppCopy,
  distribution: DistributionState,
  session: SessionState
): string | undefined => {
  if (!session.giftcards.length || !gas_empty_error(distribution.error)) return undefined
  const t = copy_text(copy.airdrop_page)
  const rewards = group_giftcards(session.giftcards)
    .map((card) => `${card.amount} × ${reward_item(card)?.name ?? t('reward_item')}`)
    .join(', ')
  return `${t('reward_received', { items: rewards })} ${t('reward_needs_sui')}`
}

/** Two lines of name in every cell, so the cells keep one height whatever the names. */
const NAME = 'line-clamp-2 h-10 w-full font-ui text-[13px]/5 font-semibold wrap-anywhere text-text'

/** One reward, laid as the Mastery shop lays its crates: a panel with the item's full picture, its name, the count. */
const GiftcardCell = ({ card, copy }: Readonly<{ card: GiftcardGroup; copy: AppCopy }>) => {
  const item = reward_item(card)
  const icon = item ? item_detail_icon(item.item_type) : null
  const name = item?.name ?? copy_text(copy.airdrop_page)('reward_item')
  return (
    <li className="aui-panel flex min-w-0 flex-col items-center gap-2 p-3 text-center">
      <span className="grid size-20 place-items-center">
        {icon ? (
          <img alt="" className="size-20 object-contain" src={icon} />
        ) : (
          <Gift className="text-gold/40" size={28} aria-hidden="true" />
        )}
      </span>
      <span className={NAME} title={name}>
        {name}
      </span>
      <span className="font-mono text-xs/4 text-gold tabular-nums">×{card.amount}</span>
    </li>
  )
}

/** The giftcards as equal cells that wrap inside their box at every width. */
export const GiftcardGrid = ({ cards, copy }: Readonly<{ cards: readonly GiftcardRow[]; copy: AppCopy }>) => (
  <ul className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2">
    {group_giftcards(cards).map((card) => (
      <GiftcardCell key={card.template} card={card} copy={copy} />
    ))}
  </ul>
)

const STATUS = {
  redeeming: { body: 'reward_redeeming', actions: ['redeem'] },
  uncertain: { body: null, actions: [] },
  needs_sui: { body: 'reward_needs_sui', actions: ['fund', 'redeem'] },
  held: { body: 'reward_held', actions: ['redeem'] },
} as const

const GiftClaimNoticeView = ({
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
  const { error, pending } = distribution
  const t = copy_text(copy.airdrop_page)
  const status = STATUS[gift_window_status(distribution)]
  const actions = { fund: { label: copy.wallet_add_funds, run: fund }, redeem: { label: t('claim_all'), run: redeem } }
  return (
    <div className="flex flex-col items-center gap-4 p-5 text-center" data-gift-window="">
      <Gift className="size-8 text-gold" aria-hidden="true" />
      <h2 className="font-title text-xl/[1.2] font-semibold text-text">{t('reward_title')}</h2>
      {/* Many cards scroll inside their box, so the window's actions stay in view. */}
      <div className="max-h-[42dvh] self-stretch overflow-y-auto text-left [scrollbar-width:thin]">
        <GiftcardGrid cards={session.giftcards} copy={copy} />
      </div>
      {status.body && (
        <p className="text-sm/[1.5] text-soft" role="status">
          {t(status.body)}
        </p>
      )}
      {error && (
        <p className="text-sm/[1.5] text-gold" role="alert">
          {player_error_text(copy, error)}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {status.actions.map((action) => (
          <Button
            key={action}
            tone="primary"
            busy={action === 'redeem' && pending === 'redeem'}
            disabled={pending !== null}
            onClick={actions[action].run}
          >
            {actions[action].label}
          </Button>
        ))}
        <Button onClick={close}>{t('reward_continue')}</Button>
      </div>
    </div>
  )
}

/** Whether a window other than the gift's is in front. The page's open windows are the registry, as for the toasts. */
const useOtherWindow = (): boolean => {
  const [other, set_other] = useState(false)
  useLayoutEffect(() => {
    const changed = (): void => {
      const front = active_modal(document)
      set_other(!!front && !front.querySelector('[data-gift-window]'))
    }
    const stop = observe_window_changes(document, changed)
    changed()
    return stop
  }, [])
  return other
}

/** The gift window of a signed-in surface: the site's shell and the game each mount it once. */
export const GiftClaimNotice = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useSiteStore((state) => state.session)
  const distribution = useSiteStore((state) => state.distribution)
  const other_window = useOtherWindow()
  const { wallet } = session
  if (!wallet || !gift_window_open({ session, distribution }, other_window)) return null
  const close = (): void => dispatch_app({ type: 'distribution/notice_dismissed', address: wallet.address })
  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={copy_text(copy.airdrop_page)('title')}>
      <GiftClaimNoticeView
        copy={copy}
        distribution={distribution}
        session={session}
        close={close}
        fund={() => dispatch_app({ type: 'funding/open' })}
        redeem={() =>
          dispatch_app({
            type: 'distribution/redeem',
            giftcards: session.giftcards.slice(0, MAX_GIFTCARDS_PER_TRANSACTION),
          })
        }
      />
    </ModalFrame>
  )
}
