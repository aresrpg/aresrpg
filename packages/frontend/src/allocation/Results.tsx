// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cap_mist, nominal_tokens, sui_amount } from '@aresrpg/immutable/allocation'
import type { BlastSnapshot } from '@aresrpg/sdk/blast'

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
/** Once a sale exists its own state is the news: the card says it and leads to the public sale. */
const SaleLink = ({ sale, url, text, kares }: Readonly<{ sale: BlastSnapshot; url: string } & Copies>) => (
  <a className="blast" href={url} target="_blank" rel="noopener noreferrer">
    <span className="blast-badge">
      <img src={blast_helmet} alt="" />
      <img className="blast-word" src={blast_wordmark} alt="Blast" />
    </span>
    <div>
      <h3>{kares[`blast_${sale.phase}`]}</h3>
      <p>{text('sale_public')}</p>
    </div>
  </a>
)
type Copies = Readonly<{ text: CopyText; kares: KaresCopy }>
/** While wallets can still buy, the step says where; before a sale it says what the cards are. */
const results_note = (sale: BlastSnapshot | null, text: CopyText): string | null => {
  if (!sale) return text('results_note')
  return sale.phase === 'soon' || sale.phase === 'live' ? text('results_note_sale') : null
}
export const Results = ({
  text,
  locale,
  kares_copy,
  sale,
  url,
}: Readonly<{ text: CopyText; locale: Locale; kares_copy: KaresCopy; sale: BlastSnapshot | null; url: string }>) => {
  const note = results_note(sale, text)
  return (
    <section className="step is-done">
      <div className="step-head">
        <span className="step-num">✓</span>
        <div>
          <h2>{text('results_title')}</h2>
          {note && <p>{note}</p>}
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
      <p className="way-fine">{text(sale ? 'sale_dilution' : 'dilution')}</p>
      {sale ? <SaleLink sale={sale} url={url} text={text} kares={kares_copy} /> : <Blast text={text} />}
      <SupplyCard copy={kares_copy} />
      {!sale && <p className="way-fine">{text('public_note')}</p>}
    </section>
  )
}
