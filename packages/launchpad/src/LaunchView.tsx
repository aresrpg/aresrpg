// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { ArrowDown, ArrowUpRight, Gamepad2, Gift } from 'lucide-react'
import nauvis_art from '@aresrpg/frontend/world-art/nauvis.webp'
import { LOCALES, type Locale } from '@aresrpg/frontend/locale'
import {
  finance_button,
  KaresLogo,
  finance_label,
  TokenomicsTab,
  type FinanceInput,
  type FinanceState,
  type KaresCopy,
} from '@aresrpg/frontend/finance'
import { WalletControl, type WalletView } from '@aresrpg/frontend/finance'

import { env } from './env.ts'
import { SaleSection } from './SaleSection.tsx'
import { AnchorNav } from './AnchorNav.tsx'
import { Benefits, PublicIncentives } from './Benefits.tsx'

export type LaunchViewProps = Readonly<{
  copy: KaresCopy
  locale: Locale
  change_locale: (locale: Locale) => void
  wallet: WalletView
  state: FinanceState
  dispatch: (input: FinanceInput) => void
}>

export const LaunchView = ({ copy, locale, change_locale, state, dispatch, wallet }: LaunchViewProps) => (
  <main className="kares-launch relative min-h-dvh overflow-x-clip text-text xl:pl-32 2xl:pl-36">
    <div className="relative mx-auto max-w-7xl px-5 sm:px-9 lg:px-14">
      <aside
        className="mt-3 flex items-start justify-center gap-3 border border-blue-400/30 bg-[#091d3b] px-4 py-3 text-[11px] leading-6 text-blue-100 sm:items-center sm:text-xs"
        data-basecamp-announcement=""
      >
        <Gift className="mt-1 shrink-0 text-gold sm:mt-0" size={15} />
        <p>{copy.basecamp_announcement}</p>
      </aside>
      <header className="relative z-40 flex flex-wrap items-center justify-between gap-4 border-b border-white/8 py-5 sm:py-7">
        <a className="flex items-center gap-3" href="https://aresrpg.world" rel="noreferrer">
          <KaresLogo size={36} />
          <span className="text-xs font-semibold tracking-[0.2em] text-gold-light uppercase">
            AresRPG <span className="mx-2 text-muted/50">/</span>
            <span className="text-[10px] text-muted">KARES</span>
          </span>
        </a>
        <div className="flex flex-wrap items-center gap-3">
          {env.network === 'testnet' && (
            <span className="border border-rose-400/25 bg-rose-400/5 px-2 py-1.5 text-[8px] text-rose-300">
              {copy.testnet}
            </span>
          )}
          <label className="sr-only" htmlFor="launch-language">
            {copy.language}
          </label>
          <select
            className="min-h-11 max-w-28 border border-white/10 bg-surface px-2 text-[10px] text-muted outline-cyan"
            id="launch-language"
            onChange={(event) => change_locale(event.target.value as Locale)}
            value={locale}
          >
            {LOCALES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.native}
              </option>
            ))}
          </select>
          <WalletControl copy={copy} wallet={wallet} />
        </div>
      </header>
      <AnchorNav copy={copy} />
      <SaleSection copy={copy} dispatch={dispatch} locale={locale} state={state} />
      <div className="grid items-start gap-8 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:py-14">
        <section>
          <p className="flex items-center gap-3 text-[9px] tracking-[0.22em] text-gold uppercase">
            <span className="h-px w-8 bg-gold/60" />
            {copy.eyebrow}
          </p>
          <h2 className="mt-6 max-w-xl text-[clamp(2.3rem,4.4vw,4rem)] leading-[1.12] font-medium tracking-[-0.05em] text-gold-light">
            {copy.join_title}
          </h2>
          <p className="mt-5 max-w-md text-xs leading-7 text-muted">{copy.join_note}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={`${finance_button} bg-gold/20`} href={env.game_url} rel="noreferrer" target="_blank">
              <Gamepad2 size={16} />
              {copy.play_game}
              <ArrowUpRight size={13} />
            </a>
            <a
              className="inline-flex min-h-11 items-center gap-2 px-2 text-[10px] text-gold hover:text-gold-light"
              href="#contribute"
            >
              {copy.contribute}
              <ArrowDown size={13} />
            </a>
          </div>
          <p className="mt-3 text-[10px] text-muted">{copy.play_game_note}</p>
          <ol className="my-7 space-y-3 border-y border-white/8 py-5">
            {[copy.step_connect, copy.step_contribute, copy.step_claim].map((step, index) => (
              <li className="flex items-center gap-3 text-[11px] text-text" key={step}>
                <span className="grid size-7 shrink-0 place-items-center border border-gold/25 bg-gold/5 text-[10px] text-gold">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
        <div className="relative min-h-64 self-stretch overflow-hidden border border-white/10 sm:min-h-96">
          <img alt="" className="absolute inset-0 size-full object-cover" src={nauvis_art} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#100d19]/70 via-transparent to-transparent" />
        </div>
      </div>
      <Benefits copy={copy} />
      <section className="border-t border-white/8 py-9">
        <h2 className="text-xl font-medium tracking-tight text-gold-light">{copy.funding_title}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[
            { share: 40, label: copy.liquidity, detail: copy.liquidity_note },
            { share: 60, label: copy.development, detail: copy.development_note },
          ].map((row) => (
            <article className="border border-white/10 bg-surface-low/60 p-5" key={row.label}>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl text-gold">{row.share}%</span>
                <h3 className="text-[10px] tracking-wider uppercase">{row.label}</h3>
              </div>
              <p className="mt-3 text-[11px] leading-6 text-muted">{row.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="launch-section border-t border-white/8 py-6" id="tokenomics">
        <p className={`${finance_label} pt-5`}>{copy.allocation_lead}</p>
        <TokenomicsTab copy={copy} />
      </section>
      <PublicIncentives copy={copy} />
      <section
        className="launch-section relative mb-10 min-h-80 overflow-hidden border border-gold/30 p-7 sm:p-10"
        id="play"
      >
        <img alt="" className="absolute inset-0 size-full object-cover" src={nauvis_art} loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/95 via-bg/85 to-bg/30" />
        <div className="relative max-w-2xl">
          <p className={finance_label}>{copy.nav_play}</p>
          <h2 className="mt-4 text-3xl font-medium tracking-tight text-gold-light sm:text-4xl">{copy.play_title}</h2>
          <p className="mt-4 text-xs leading-7 text-text/75">{copy.play_detail}</p>
          <a className={`${finance_button} mt-6 bg-gold/20`} href={env.game_url} rel="noreferrer" target="_blank">
            <Gamepad2 size={17} />
            {copy.play_game}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-4 border-t border-white/8 py-7 text-[9px] text-muted">
        <span>AresRPG · KARES</span>
        <a className="hover:text-gold" href={env.discord_url} rel="noreferrer" target="_blank">
          Discord <ArrowUpRight className="inline" size={11} />
        </a>
      </footer>
    </div>
  </main>
)
