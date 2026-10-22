// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PointerEvent } from 'react'
import { nominal_tokens, cap_mist, sui_amount } from '@aresrpg/immutable/allocation'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'

import { helmet, kares } from './assets.ts'
import type { CardView } from './view.ts'
import type { AllocationRuntime } from './runtime.ts'

const describe_card = (card: CardView, text: CopyText, locale: Locale) => {
  const { award, pending, wallet } = card
  const tier = award?.tier ?? (pending ? 'pending' : 'no_spot')
  const base = {
    tier,
    face: pending ? 'cc-back' : 'cc-none',
    source: text(tier),
    label: text('wallet'),
    value: wallet.label || text('google_wallet'),
    cap: null as string | null,
  }
  if (!award) return base
  return {
    ...base,
    face: `cc-spot ${tier}`,
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
}: Readonly<{ card: CardView; text: CopyText; locale: Locale; runtime: AllocationRuntime; busy: boolean }>) => {
  const { wallet } = card
  const description = describe_card(card, text, locale)
  return (
    <div className="slot">
      <article
        className={`cc ${description.face}`}
        data-allocation-wallet={wallet.address}
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
          <span className="cc-chip" />
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
      <div className="slot-actions">
        <button
          className="btn btn-small"
          disabled={busy}
          onClick={() => runtime.dispatch({ type: 'request', task: { kind: 'share', address: wallet.address } })}
        >
          {text('share')}
        </button>
      </div>
    </div>
  )
}
