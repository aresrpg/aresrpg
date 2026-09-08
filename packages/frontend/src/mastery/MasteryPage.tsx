// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Gem, Loader2, Sparkles } from 'lucide-react'
import type { MasteryRow } from '@aresrpg/protocol'
import type { CSSProperties } from 'react'

import { content_catalog, titleize } from '../content/catalog.ts'
import { world_card_rows } from '../content/world_cards.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { MasteryShop } from './MasteryShop.tsx'
import {
  effective_mastery_points,
  mastery_dungeon_slug,
  mastery_quest_is_current,
  mastery_reward,
  mastery_world_witness,
} from './model.ts'

const world_art_style = (art: string | null | undefined): CSSProperties =>
  Object.freeze({ backgroundImage: art ? `url(${JSON.stringify(art)})` : 'none' })

const mastery_quest_identity = (row: MasteryRow | null, cards: Readonly<ReturnType<typeof world_card_rows>>) => {
  if (!row) return Object.freeze({ dungeon: null, world_card: undefined })
  return Object.freeze({
    dungeon: mastery_dungeon_slug(row.quest_dungeon),
    world_card: cards.find(({ id }) => id === row.quest_world),
  })
}

export default function MasteryPage({ copy }: Readonly<{ copy: AppCopy }>) {
  const text = copy_text(copy.mastery_page)
  const mastery = useAppStore((state) => state.mastery)
  const characters = useAppStore((state) => state.session.characters)
  const current_epoch = useAppStore((state) => state.session.current_epoch)
  const connected = useAppStore((state) => !!state.session.wallet && state.session.link_status === 'ready')
  const points = effective_mastery_points(mastery.row, current_epoch)
  const quest_current = mastery_quest_is_current(mastery.row, current_epoch)
  const world_cards = world_card_rows()
  const { dungeon, world_card: quest_world_card } = mastery_quest_identity(mastery.row, world_cards)
  const dungeon_name = dungeon ? titleize(dungeon) : text('unknown_dungeon')

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
          <div
            className="relative mt-4 grid min-h-52 gap-3 overflow-hidden border border-cyan/25 bg-cover bg-center p-4 md:grid-cols-[1fr_auto] md:items-center"
            style={world_art_style(quest_world_card?.art)}
          >
            <span className="absolute inset-0 bg-gradient-to-r from-[#080b12]/96 via-[#080b12]/78 to-[#080b12]/52" />
            <div className="relative">
              <div className="text-[8px] tracking-[0.2em] text-muted uppercase">
                {titleize(mastery.row.quest_world)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] leading-5 text-cyan">
                <span>{text('quest_objective_before')}</span>
                <strong className="border border-gold/55 bg-gold/12 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-gold uppercase shadow-[0_0_18px_rgba(200,150,60,0.12)]">
                  {dungeon_name}
                </strong>
                <span>{text('quest_objective_after')}</span>
              </div>
              <div className="mt-1 text-[9px] text-muted">
                {text('quest_reward', { points: mastery.row.quest_reward })}
              </div>
            </div>
            <div
              className={`relative flex items-center justify-center gap-2 border px-4 py-3 text-[9px] tracking-[0.18em] uppercase ${
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
            {world_cards.map((card) => {
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

      <MasteryShop copy={copy} />
    </section>
  )
}
