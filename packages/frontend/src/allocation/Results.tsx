// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cap_mist, nominal_tokens, sui_amount } from '@aresrpg/immutable/allocation'

import type { CopyText } from '../i18n/copy.ts'
import type { KaresCopy } from '../kares/copy.ts'
import type { Locale } from '../i18n/locale.ts'

import { SupplyCard } from './SupplyCard.tsx'
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
  locale,
  kares_copy,
}: Readonly<{ text: CopyText; locale: Locale; kares_copy: KaresCopy }>) => (
  <section className="step is-done">
    <div className="step-head">
      <span className="step-num">✓</span>
      <div>
        <h2>{text('results_title')}</h2>
        <p>{text('results_note')}</p>
      </div>
    </div>
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
    <SupplyCard copy={kares_copy} />
    <p className="way-fine">{text('public_note')}</p>
  </section>
)
