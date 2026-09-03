// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Gem, Loader2, LockKeyhole, Sparkles } from 'lucide-react'

import { content_catalog, titleize } from '../content/catalog.ts'
import { item_icon } from '../content/assets.ts'
import { world_card_rows } from '../content/world_cards.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import {
  effective_mastery_points,
  mastery_dungeon_slug,
  mastery_quest_is_current,
  mastery_reward,
  mastery_world_witness,
} from './model.ts'

export default function MasteryPage({ copy }: Readonly<{ copy: AppCopy }>) {
  const text = copy_text(copy.mastery_page)
  const mastery = useAppStore((state) => state.mastery)
  const characters = useAppStore((state) => state.session.characters)
  const current_epoch = useAppStore((state) => state.session.current_epoch)
  const connected = useAppStore((state) => !!state.session.wallet && state.session.link_status === 'ready')
  const points = effective_mastery_points(mastery.row, current_epoch)
  const quest_current = mastery_quest_is_current(mastery.row, current_epoch)
  const dungeon = mastery.row ? mastery_dungeon_slug(mastery.row.quest_dungeon) : null
  const offers = mastery.offers
    .flatMap((state) => {
      const authored = content_catalog.mastery.offers.find(({ item_type }) => item_type === state.item_type)
      return state.enabled && authored?.item ? [Object.freeze({ state, authored, item: authored.item })] : []
    })
    .toSorted((left, right) => {
      const left_cost = BigInt(left.state.cost)
      const right_cost = BigInt(right.state.cost)
      return left_cost < right_cost ? -1 : left_cost > right_cost ? 1 : 0
    })

  return (
    <section className="pointer-events-auto min-h-full flex-1 overflow-y-auto border border-border bg-bg/97 p-3 lg:p-8">
      <header className="relative overflow-hidden border border-border bg-surface-low/92 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.32)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_20%,rgba(72,207,207,0.12),transparent_34%),radial-gradient(circle_at_15%_0%,rgba(200,150,60,0.13),transparent_38%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="text-[8px] tracking-[0.32em] text-cyan uppercase">{text('subtitle')}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-[0.14em] text-text uppercase">{text('title')}</h1>
            <p className="mt-3 max-w-2xl text-[10px] leading-5 text-muted">{text('lead')}</p>
          </div>
          <div className="min-w-44 border border-gold/25 bg-black/20 p-4 text-right">
            <div className="text-[8px] tracking-[0.22em] text-muted uppercase">{text('balance')}</div>
            <div className="mt-1 flex items-center justify-end gap-2 text-3xl font-semibold text-gold tabular-nums">
              <Gem size={19} /> {points.toString()}
            </div>
            <div className="mt-1 text-[8px] tracking-[0.16em] text-muted uppercase">
              {current_epoch ? text('daily_ready') : text('daily_syncing')}
            </div>
          </div>
        </div>
      </header>

      <section className="mt-5 border border-border bg-surface/82 p-4 lg:p-5">
        <div className="flex items-center gap-3">
          <Sparkles className="text-cyan" size={16} />
          <div>
            <div className="text-[9px] font-semibold tracking-[0.24em] text-cyan uppercase">{text('daily_title')}</div>
            <div className="mt-1 text-[9px] text-muted">{text('daily_lead')}</div>
          </div>
        </div>

        {quest_current && mastery.row ? (
          <div className="mt-4 grid gap-3 border border-cyan/20 bg-cyan/4 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="text-[8px] tracking-[0.2em] text-muted uppercase">
                {titleize(mastery.row.quest_world)}
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[0.1em] text-text uppercase">
                {dungeon ? titleize(dungeon) : text('unknown_dungeon')}
              </div>
              <div className="mt-2 text-[9px] text-muted">
                {text('quest_reward', { points: mastery.row.quest_reward })}
              </div>
            </div>
            <div
              className={`flex items-center justify-center gap-2 border px-4 py-3 text-[9px] tracking-[0.18em] uppercase ${
                mastery.row.quest_completed
                  ? 'border-gold/35 bg-gold/8 text-gold'
                  : 'border-cyan/30 bg-cyan/7 text-cyan'
              }`}
            >
              {mastery.row.quest_completed ? <Check size={14} /> : <Sparkles size={14} />}
              {mastery.row.quest_completed ? text('completed') : text('in_progress')}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {world_card_rows().map((card) => {
              const world = content_catalog.world(card.id)!
              const witness = mastery_world_witness(characters, world)
              const available = !!witness && world.cities.length > 0 && current_epoch !== null
              const busy = mastery.pending === 'start'
              return (
                <article
                  className={`group relative min-h-52 overflow-hidden border text-left transition-colors ${
                    available
                      ? 'border-cyan/25 bg-cyan/4 hover:border-cyan/55'
                      : 'border-white/7 bg-black/15 opacity-45 grayscale'
                  }`}
                  data-world-card={card.id}
                  key={card.id}
                >
                  {card.art && (
                    <img
                      alt=""
                      className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-[1.025]"
                      src={card.art}
                    />
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-[#080b12] via-[#080b12]/48 to-black/12" />
                  <div className="relative flex items-start justify-between gap-3 p-4">
                    <div>
                      <div className="text-[11px] font-semibold tracking-[0.16em] text-text uppercase">
                        {card.label}
                      </div>
                      <div className="mt-2 text-[8px] tracking-[0.13em] text-muted uppercase">
                        {text('required_level', { level: world.entry_level })}
                      </div>
                    </div>
                    <span className="relative rotate-2 overflow-hidden border-2 border-[#ffe19a] bg-[linear-gradient(180deg,#ffd86b,#d79721)] px-3 py-1.5 text-base font-black tracking-[-0.04em] text-[#251506] shadow-[0_4px_0_#7b4a0d,0_8px_20px_rgba(0,0,0,0.38)] transition-transform group-hover:rotate-0 group-hover:scale-105">
                      <span aria-hidden="true" className="absolute top-1 left-1 h-1 w-6 bg-white/65" />
                      <span aria-hidden="true" className="absolute top-2 left-1 h-1 w-3 bg-white/35" />
                      <span className="relative">
                        {text('world_reward', { points: mastery_reward(world.entry_level) })}
                      </span>
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-[8px] tracking-[0.15em] uppercase">
                    <span className="text-muted">{text('dungeon_count', { count: world.cities.length })}</span>
                    <button
                      className="relative flex min-w-36 cursor-pointer items-center justify-center gap-2 overflow-hidden border-2 border-[#b9dcff] bg-[linear-gradient(180deg,#58adff,#246ed2)] px-4 py-2.5 text-[10px] font-black tracking-[0.13em] text-[#061326] shadow-[0_4px_0_#123d78,0_8px_24px_rgba(0,0,0,0.42)] transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-[#30343b] disabled:text-[#777d87] disabled:shadow-[0_4px_0_#17191d]"
                      disabled={!available || mastery.pending !== null || !connected}
                      onClick={() => dispatch_app({ type: 'mastery/start', world: world.world })}
                      type="button"
                    >
                      <span aria-hidden="true" className="absolute top-1 left-2 h-1 w-10 bg-white/65" />
                      <span aria-hidden="true" className="absolute top-2 left-2 h-1 w-5 bg-white/30" />
                      <span aria-hidden="true" className="absolute right-2 bottom-1 size-1 bg-[#0e4da8]/60" />
                      <span className="relative flex items-center gap-2">
                        {busy ? <Loader2 className="animate-spin" size={13} /> : <Sparkles size={13} />}
                        {busy ? text('starting') : available ? text('start') : text('locked')}
                      </span>
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="mt-5 border border-border bg-surface-low/78 p-4 lg:p-5">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <div className="text-[9px] font-semibold tracking-[0.24em] text-gold uppercase">{text('offers_title')}</div>
            <p className="mt-1 text-[9px] text-muted">{text('offers_lead')}</p>
          </div>
          <div className="text-[8px] tracking-[0.18em] text-muted uppercase">{text('progression')}</div>
        </div>

        {offers.length === 0 ? (
          <div className="py-12 text-center text-[9px] tracking-[0.16em] text-muted uppercase">
            {text('offers_empty')}
          </div>
        ) : (
          <div className="relative mx-auto mt-5 max-w-4xl">
            <div className="absolute top-0 bottom-0 left-6 w-px bg-gradient-to-b from-gold/45 via-cyan/25 to-white/5 md:left-1/2" />
            <div className="space-y-3">
              {offers.map(({ state, item }, index) => {
                const cost = BigInt(state.cost)
                const affordable = points >= cost
                const busy = mastery.pending === `redeem:${state.item_type}`
                return (
                  <article
                    className={`relative ml-12 border p-4 md:ml-0 md:w-[calc(50%-2rem)] ${
                      index % 2 === 0 ? 'md:mr-auto' : 'md:ml-auto'
                    } ${
                      affordable
                        ? 'border-gold/28 bg-[linear-gradient(135deg,rgba(200,150,60,0.09),rgba(72,207,207,0.035))]'
                        : 'border-white/7 bg-black/15 opacity-48 grayscale'
                    }`}
                    key={state.item_type}
                  >
                    <div className="absolute top-1/2 -left-9 grid size-6 -translate-y-1/2 place-items-center border border-border bg-bg text-gold md:-left-11 md:odd:left-auto md:odd:-right-11">
                      {affordable ? <Gem size={12} /> : <LockKeyhole size={11} />}
                    </div>
                    <div className="flex gap-4">
                      <div className="grid size-16 shrink-0 place-items-center border border-white/8 bg-black/20">
                        {item_icon(item.item_type) ? (
                          <img alt="" className="size-14 object-contain" src={item_icon(item.item_type)!} />
                        ) : (
                          <Gem className="text-gold/40" size={25} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[11px] font-semibold tracking-[0.12em] text-text uppercase">
                          {item.name}
                        </h3>
                        <div className="mt-2 text-[9px] text-muted">
                          {affordable ? text('ready') : text('missing', { points: (cost - points).toString() })}
                        </div>
                        <button
                          className="mt-4 flex cursor-pointer items-center gap-2 border border-gold/35 bg-gold/8 px-4 py-2 text-[8px] tracking-[0.17em] text-gold uppercase hover:bg-gold/13 disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/3 disabled:text-muted"
                          disabled={!affordable || mastery.pending !== null || !connected || current_epoch === null}
                          onClick={() => dispatch_app({ type: 'mastery/redeem', item_type: state.item_type })}
                          type="button"
                        >
                          {busy ? <Loader2 className="animate-spin" size={11} /> : <LockKeyhole size={11} />}
                          {busy ? text('unlocking') : text('unlock', { cost: state.cost })}
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </section>
  )
}
