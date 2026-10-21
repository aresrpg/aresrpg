// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { campaign, cap_mist, nominal_tokens, sui_amount } from '@aresrpg/immutable/allocation'

import type { CopyText } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'

import { blast_helmet, blast_wordmark } from './assets.ts'
export const Blast = ({ text }: Readonly<{ text: CopyText }>) => (
  <section className="blast">
    <span className="blast-badge">
      <img src={blast_helmet} alt="" />
      <img className="blast-word" src={blast_wordmark} alt="Blast" />
    </span>
    <div>
      <h3>{text('sale_title')}</h3>
      <p>{text('sale_time')}</p>
    </div>
  </section>
)
export const Results = ({
  text,
  final,
  open,
  locale,
}: Readonly<{ text: CopyText; final: boolean; open: boolean; locale: Locale }>) => (
  <section className={`step ${final ? 'is-done' : ''}`}>
    <div className="step-head">
      <span className="step-num">{final ? '✓' : '3'}</span>
      <div>
        <h2>{text('results_title')}</h2>
        <p>{text('results_note')}</p>
      </div>
    </div>
    <ol className="when">
      <li className={open ? 'is-now' : ''}>
        <b>{text('entries_close')}</b>
        <span>
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(campaign.submissions_close_at)
          )}{' '}
          · {text('your_time')}
        </span>
      </li>
      <li className={!open && !final ? 'is-now' : ''}>
        <b>{text('cards_revealed')}</b>
        <span>{text('results_time')}</span>
      </li>
      <li className={final ? 'is-now' : ''}>
        <b>{text('sale_title')}</b>
        <span>{text('sale_time')}</span>
      </li>
    </ol>
    <div className="tiers">
      <p className="kicker">{text('spot_gives')}</p>
      {(['veteran', 'member'] as const).map((tier) => (
        <div key={tier} className={`tier ${tier}`}>
          <b>{text(tier)}</b>
          <span>
            {text('buy_up_to')} {sui_amount(cap_mist(tier))} SUI · ≈{' '}
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(nominal_tokens(tier))} KARES
          </span>
        </div>
      ))}
    </div>
    <p className="way-fine">{text('before')}</p>
    <Blast text={text} />
    <p className="way-fine">{text('public_note')}</p>
  </section>
)
