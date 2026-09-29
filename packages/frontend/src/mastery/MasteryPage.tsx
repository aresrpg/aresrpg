// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Loader2, Sparkles } from 'lucide-react'
import type { MasteryRow } from '@aresrpg/protocol'
import type { CSSProperties } from 'react'
import { Button } from '@aresrpg/ui'

import { content_catalog, titleize } from '../content/catalog.ts'
import { world_card_rows } from '../content/world_cards.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'

import { useMasterySource } from './MasterySource.tsx'
import './mastery.css'
import { MasteryShop } from './MasteryShop.tsx'
import { mastery_dungeon_slug, mastery_quest_is_current, mastery_reward, mastery_world_witness } from './model.ts'

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
  const { mastery, characters, current_epoch, connected, dispatch: dispatch_app } = useMasterySource()
  const quest_current = mastery_quest_is_current(mastery.row, current_epoch)
  const world_cards = world_card_rows()
  const { dungeon, world_card: quest_world_card } = mastery_quest_identity(mastery.row, world_cards)
  const dungeon_name = dungeon ? titleize(dungeon) : text('unknown_dungeon')

  return (
    <section className="mastery-page">
      <header className="mastery-summary">
        <p>{text('lead')}</p>
        <span>{current_epoch ? text('daily_ready') : text('daily_syncing')}</span>
      </header>
      <div className="mastery-body">
        <section className="mastery-quests">
          <div className="flex items-center gap-3">
            <Sparkles className="text-cyan" size={16} />
            <div>
              <div className="text-[9px] font-semibold tracking-[0.24em] text-cyan uppercase">
                {text('daily_title')}
              </div>
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
                    <div className="mastery-world-heading">
                      <div>
                        <div className="text-[11px] font-semibold tracking-[0.16em] text-text uppercase">
                          {card.label}
                        </div>
                        <div className="mt-2 text-[8px] tracking-[0.13em] text-muted uppercase">
                          {text('required_level', { level: world.entry_level })}
                        </div>
                      </div>
                      <span className="mastery-world-reward">
                        {text('world_reward', { points: mastery_reward(world.entry_level) })}
                      </span>
                    </div>
                    <div className="mastery-world-actions">
                      <span className="text-muted">{text('dungeon_count', { count: world.cities.length })}</span>
                      <Button
                        tone="primary"
                        disabled={!available || mastery.pending !== null || !connected}
                        onClick={() => dispatch_app({ type: 'mastery/start', world: world.world })}
                        type="button"
                      >
                        <span className="relative flex items-center gap-2">
                          {busy ? <Loader2 className="animate-spin" size={13} /> : <Sparkles size={13} />}
                          {busy ? text('starting') : available ? text('start') : text('locked')}
                        </span>
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <MasteryShop copy={copy} />
      </div>
    </section>
  )
}
