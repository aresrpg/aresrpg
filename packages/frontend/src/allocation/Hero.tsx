// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'
import { campaign } from '@aresrpg/immutable/allocation'
import type { BlastSnapshot } from '@aresrpg/sdk/blast'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import type { KaresCopy } from '../kares/copy.ts'

import type { AllocationRuntime, AllocationState } from './runtime.ts'
import type { allocation_view } from './view.ts'
import { Timer } from './clock.tsx'
import { TierCard } from './TierCard.tsx'
import { SaleHero } from './SaleHero.tsx'

export type View = ReturnType<typeof allocation_view>
const Total = ({ view, text, locale }: Readonly<{ view: View; text: CopyText; locale: Locale }>) => {
  const total = view.spots
    ? `≈ ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(view.tokens)} KARES`
    : text(view.cards.length ? 'no_spot_yet' : 'your_allocation')
  return (
    <p className="hero-total">
      {total}
      <small>
        {view.spots ? (
          <>
            <b>{text('before')}</b> · {text('total_cap', { sui: view.sui, count: view.spots })}
          </>
        ) : (
          text(view.final ? 'no_spot' : 'allocation_note')
        )}
      </small>
    </p>
  )
}
const Share = ({ url, text }: Readonly<{ url: string | null; text: CopyText }>) => {
  if (!url) return null
  const preview = new URL(url).searchParams.get('url')!
  return (
    <div className="share-actions">
      <a className="btn" href={preview} target="_blank" rel="noopener noreferrer">
        {text('preview')}
      </a>
    </div>
  )
}
const CampaignHead = ({
  view,
  text,
  locale,
  open,
}: Readonly<{ view: View; text: CopyText; locale: Locale; open: boolean }>) => (
  <>
    <p className="hero-label">{text(view.final ? 'title' : open ? 'close_in' : 'closed')}</p>
    {view.final ? <p className="done-title">{text('final')}</p> : <Timer text={text} closed={!open} />}
    <p className="deadline">
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(campaign.submissions_close_at)
      )}{' '}
      · {text('your_time')} ·{' '}
      {new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'UTC',
      }).format(new Date(campaign.submissions_close_at))}{' '}
      UTC
    </p>
    <span className="rule" />
    <Total view={view} text={text} locale={locale} />
  </>
)
export const Hero = ({
  view,
  state,
  runtime,
  text,
  locale,
  open,
  sale,
  now,
  kares,
  spot,
}: Readonly<{
  view: View
  state: AllocationState
  runtime: AllocationRuntime
  text: CopyText
  locale: Locale
  open: boolean
  sale: BlastSnapshot | null
  now: number
  kares: KaresCopy
  spot: (card: View['cards'][number]) => ReactNode
}>) => (
  <section className="hero">
    {sale ? (
      <SaleHero sale={sale} spots={view.spots} now={now} text={text} kares={kares} locale={locale} />
    ) : (
      <CampaignHead view={view} text={text} locale={locale} open={open} />
    )}
    {view.cards.length > 0 && (
      <div className={`stage ${view.cards.length < 2 ? 'is-one' : ''}`}>
        {view.cards.map((card) => (
          <TierCard
            key={card.wallet.address}
            card={card}
            text={text}
            locale={locale}
            runtime={runtime}
            busy={!!state.task}
          >
            {spot(card)}
          </TierCard>
        ))}
      </div>
    )}
    {view.spots > 0 && <p className="estimate-note">{text(sale ? 'sale_dilution' : 'dilution')}</p>}
    <Share url={state.share_intent_url} text={text} />
  </section>
)
