// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowUpRight, Flame, Gem, Sparkles, Waves } from 'lucide-react'
import { KARES_ALLOCATION } from '@aresrpg/sdk/kares-economics'
import { finance_label, format_amount, type KaresCopy } from '@aresrpg/frontend/finance'

import food_crate from '../../../seed/icons/items/food_crate_hd.png'
import resource_crate from '../../../seed/icons/items/resource_crate_hd.png'
import pet_crate from '../../../seed/icons/items/pet_crate_hd.png'
import sui_crate from '../../../seed/icons/items/sui_crate_hd.png'

export const Benefits = ({ copy }: Readonly<{ copy: KaresCopy }>) => (
  <section className="launch-section border-t border-white/8 py-12 sm:py-16" id="benefits">
    <p className={finance_label}>{copy.nav_benefits}</p>
    <h2 className="mt-4 max-w-3xl text-3xl font-medium tracking-tight text-gold-light sm:text-4xl">
      {copy.benefits_title}
    </h2>
    <p className="mt-4 max-w-2xl text-xs leading-7 text-muted">{copy.benefits_lead}</p>
    <div className="mt-8 grid gap-5 lg:grid-cols-2">
      <article className="benefit-card benefit-revenue relative overflow-hidden border border-cyan/35 p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="benefit-orbit absolute -right-9 -top-9 grid size-48 place-items-center rounded-full border border-cyan/15"
        >
          <Waves className="text-cyan/20" size={85} />
        </div>
        <div className="relative">
          <span className="inline-flex items-center gap-2 border border-cyan/35 bg-cyan/10 px-3 py-2 text-[9px] tracking-wider text-cyan uppercase">
            <Waves size={14} />
            {copy.revenue_title}
          </span>
          <div className="mt-7 text-7xl font-semibold tracking-[-0.07em] text-cyan sm:text-8xl">
            20<span className="text-4xl">%</span>
          </div>
          <p className="mt-4 max-w-md text-2xl font-semibold leading-tight text-cyan sm:text-3xl">
            {copy.revenue_metric}
          </p>
          <p className="mt-5 max-w-lg text-base font-medium leading-7 text-text">{copy.revenue_detail}</p>
        </div>
      </article>
      <article className="benefit-card benefit-baseline relative overflow-hidden border border-gold/35 p-6 sm:p-8">
        <Gem aria-hidden="true" className="benefit-art absolute -right-3 top-12 rotate-12 text-gold/10" size={170} />
        <div className="relative">
          <span className="inline-flex items-center gap-2 border border-gold/35 bg-gold/10 px-3 py-2 text-[9px] tracking-wider text-gold uppercase">
            <Sparkles size={14} />
            {copy.five_years}
          </span>
          <div className="mt-7 text-5xl font-semibold tracking-[-0.06em] text-gold-light sm:text-6xl">
            {format_amount(KARES_ALLOCATION.rewards)}
          </div>
          <p className="mt-3 text-[11px] tracking-wider text-gold uppercase">KARES</p>
          <h3 className="mt-5 text-base text-gold-light">{copy.baseline_title}</h3>
          <p className="mt-4 text-[11px] leading-7 text-text/80">{copy.baseline_detail}</p>
        </div>
      </article>
      <article className="benefit-card benefit-crates relative overflow-hidden border border-purple-300/25 p-6 sm:p-8 lg:col-span-2">
        <div className="grid items-center gap-7 md:grid-cols-[1.15fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 text-[9px] tracking-wider text-purple-200 uppercase">
              <Flame size={14} />
              {copy.mastery_title}
            </span>
            <h3 className="mt-5 text-3xl font-medium tracking-tight text-gold-light">{copy.crates_title}</h3>
            <p className="mt-4 max-w-xl text-[11px] leading-7 text-text/80">{copy.crates_detail}</p>
            <a className="mt-5 inline-flex items-center gap-2 text-[10px] text-gold" href="#play">
              {copy.play_testnet}
              <ArrowUpRight size={13} />
            </a>
          </div>
          <div aria-hidden="true" className="grid grid-cols-2 gap-1">
            {[food_crate, resource_crate, pet_crate, sui_crate].map((art, index) => (
              <div className="relative grid min-h-28 place-items-center" key={art}>
                <img
                  alt=""
                  className="benefit-art relative size-28 object-contain drop-shadow-[0_12px_14px_#0009] sm:size-36"
                  loading="lazy"
                  src={art}
                  style={{ animationDelay: `${index * -0.8}s` }}
                />
              </div>
            ))}
          </div>
        </div>
      </article>
    </div>
  </section>
)

export const PublicIncentives = ({ copy }: Readonly<{ copy: KaresCopy }>) => (
  <section className="launch-section relative overflow-hidden border-t border-white/8 py-12 sm:py-16" id="incentives">
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <p className={finance_label}>{copy.nav_incentives}</p>
        <h2 className="mt-4 text-3xl font-medium tracking-tight text-gold-light sm:text-4xl">
          {copy.incentives_title}
        </h2>
        <p className="mt-5 text-xs leading-7 text-muted">{copy.incentives_detail}</p>
        <p className="mt-4 text-[10px] leading-6 text-muted">{copy.incentives_clock}</p>
      </div>
      <div className="border border-cyan/20 bg-[linear-gradient(145deg,#223240,var(--color-surface-low))] p-6">
        <div className="flex items-center justify-center gap-5 py-5">
          <span className="grid size-20 place-items-center border border-cyan/35 bg-cyan/10 text-xl font-semibold text-cyan">
            SUI
          </span>
          <span className="text-xl text-muted">+</span>
          <span className="grid size-20 place-items-center border border-gold/35 bg-gold/10 text-sm font-semibold text-gold">
            KARES
          </span>
        </div>
        <p className="mt-5 text-center text-base leading-7 text-gold-light">{copy.incentives_examples}</p>
        <p className="mt-4 text-center text-[10px] leading-6 text-muted">{copy.fund_note}</p>
      </div>
    </div>
  </section>
)
