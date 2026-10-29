// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PointerEvent, ReactNode } from 'react'
import { campaign, nominal_tokens, cap_mist, sui_amount } from '@aresrpg/immutable/allocation'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'

import { helmet, kares, card_relief, card_veteran, card_member } from './assets.ts'
import type { CardView } from './view.ts'
import type { AllocationRuntime } from './runtime.ts'

const describe_card = (card: CardView, text: CopyText, locale: Locale) => {
  const { award } = card
  const review = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(campaign.submissions_close_at)
  )
  if (!award)
    return {
      tier: 'pending',
      face: 'cc-pending',
      source: text(card.pending_source === 'social' ? 'x_entry' : 'leaderboard_title'),
      label: text('entries_close'),
      value: review,
      cap: null,
    }
  return {
    tier: award.tier,
    face: `cc-spot ${award.tier}`,
    source: award.board ? text(`board_${award.board}`) : text(`source_${award.source}`),
    label: text('before'),
    value: `≈ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(nominal_tokens(award.tier))} KARES`,
    cap: `${sui_amount(cap_mist(award.tier))} SUI`,
  }
}

const stop_tilt = (element: Readonly<HTMLElement>): void => {
  element.classList.remove('tilting')
  element.style.removeProperty('--rx')
  element.style.removeProperty('--ry')
  element.style.removeProperty('--sx')
}
const tilt = (event: Readonly<PointerEvent<HTMLElement>>): void => {
  if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const element = event.currentTarget
  const bounds = element.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / bounds.width
  const y = (event.clientY - bounds.top) / bounds.height
  element.classList.add('tilting')
  element.style.setProperty('--ry', `${(x - 0.5) * 10}deg`)
  element.style.setProperty('--rx', `${(0.5 - y) * 8}deg`)
  element.style.setProperty('--sx', `${x * 100}%`)
}

export const TierCard = ({
  card,
  text,
  locale,
  runtime,
  busy,
  children,
}: Readonly<{
  card: CardView
  text: CopyText
  locale: Locale
  runtime: AllocationRuntime
  busy: boolean
  /** The sale panel replaces sharing once a sale is configured. */
  children?: ReactNode
}>) => {
  const { wallet } = card
  const description = describe_card(card, text, locale)
  const backgrounds: Readonly<Record<string, string>> = {
    veteran: card_veteran,
    member: card_member,
    pending: card_relief,
  }
  return (
    <div className="slot">
      <article
        className={`cc ${description.face}`}
        data-allocation-wallet={wallet.address}
        style={{ backgroundImage: `url("${backgrounds[description.tier]}")` }}
        onPointerMove={tilt}
        onPointerLeave={(event) => stop_tilt(event.currentTarget)}
        key={`${wallet.address}:${description.tier}`}
      >
        <div className="cc-top">
          <span className="cc-brand">
            <img src={helmet} alt="" />
            KARES
          </span>
          <span className="cc-src">{description.source}</span>
        </div>
        <div className="cc-mid">
          <span className="cc-chip" aria-hidden="true" />
          <span className="cc-tier">{text(description.tier)}</span>
        </div>
        <div className="cc-number" title={wallet.address}>
          {wallet.address.slice(0, 6)} {wallet.address.slice(6, 10)} •••• {wallet.address.slice(-4)}
        </div>
        <div className="cc-bottom">
          <div className="cc-kares">
            <small>{description.label}</small>
            <b>{description.value}</b>
          </div>
          {description.cap && (
            <div>
              <small>{text('buy_up_to')}</small>
              <b>{description.cap}</b>
            </div>
          )}
          <img className="cc-logo" src={kares} alt="" />
        </div>
        <span className="cc-sheen" />
      </article>
      {!card.award && (
        <div className="card-outlook">
          {card.prediction && (
            <>
              <p className="card-rank">
                <span>{text('current_rank')}</span>
                <b>#{card.prediction.rank}</b>
              </p>
              <p>{text(`board_${card.prediction.board}`)}</p>
              {card.prediction.tier && <p>{text('projected_tier', { tier: text(card.prediction.tier) })}</p>}
              <small>{text('rank_warning')}</small>
            </>
          )}
          <p>{text('pending_note')}</p>
        </div>
      )}
      {children ?? (
        <div className="slot-actions">
          <button
            className="btn btn-small"
            disabled={busy}
            onClick={() =>
              runtime.dispatch({
                type: 'request',
                task: {
                  kind: 'share',
                  address: wallet.address,
                  locale,
                  text: card.award ? text('share_post', { tier: text(card.award.tier) }) : text('share_pending'),
                },
              })
            }
          >
            {text('share')}
          </button>
        </div>
      )}
    </div>
  )
}
