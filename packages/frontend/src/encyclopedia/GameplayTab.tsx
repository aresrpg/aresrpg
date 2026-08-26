// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { max_level, xp_for_level } from '@aresrpg/immutable'
import { RETRO_GROUP_XP_TENTHS } from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { Activity, Coins, Crown, DoorOpen, Sparkles, Swords, TrendingUp, Users, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { element_colors } from '../visual_identity.ts'
import { encyclopedia_catalog, titleize } from '../content/catalog.ts'

import type { EncyclopediaText } from './copy.ts'
import { Fact } from './components.tsx'

const SECTIONS = [
  { id: 'combat', icon: Swords },
  { id: 'leveling', icon: TrendingUp },
  { id: 'stats', icon: Activity },
  { id: 'loot', icon: Sparkles },
  { id: 'groups', icon: Users },
  { id: 'dungeons', icon: DoorOpen },
  { id: 'classes', icon: Crown },
  { id: 'economy', icon: Coins },
  { id: 'forgemagie', icon: Zap },
] as const

const WikiSection = ({
  id,
  title,
  children,
}: Readonly<{
  id: string
  title: string
  children: React.ReactNode
}>) => (
  <section className="scroll-mt-5 space-y-3" data-gameplay-section={id} id={`encyclopedia-${id}`}>
    <h2 className="border-b border-[#c8963c]/15 pb-3 text-[11px] font-semibold tracking-[0.3em] text-[#d5a95a] uppercase">
      {title}
    </h2>
    {children}
  </section>
)

const Text = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <p className="text-[10px] leading-6 text-[#9a9da7]">{children}</p>
)
const Subheading = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <h3 className="pt-2 text-[9px] font-semibold tracking-[0.18em] text-[#d6d1c8] uppercase">{children}</h3>
)
const Formula = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <div className="border border-border bg-white/3 px-3 py-2 font-mono text-[9px] tracking-wide text-[#c8963c]/80">
    {children}
  </div>
)

export const GameplayTab = ({ text }: Readonly<{ text: EncyclopediaText }>) => {
  const [active_section, set_active_section] = useState('combat')
  const content_ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = content_ref.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find(({ isIntersecting }) => isIntersecting)
        const id = visible?.target.getAttribute('data-gameplay-section')
        if (id) set_active_section(id)
      },
      { root, rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    )
    root.querySelectorAll('[data-gameplay-section]').forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  const go = (id: string): void =>
    content_ref.current
      ?.querySelector(`[data-gameplay-section="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden max-[760px]:flex-col">
      <aside className="flex w-[300px] min-w-[300px] flex-col border-r border-border max-[760px]:w-full max-[760px]:min-w-0 max-[760px]:border-r-0 max-[760px]:border-b">
        <div className="border-b border-border px-3 py-3 max-[760px]:hidden">
          <span className="text-[9px] tracking-[0.25em] text-[#6b7280] uppercase">
            {text('gameplay.game_mechanics')}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto max-[760px]:flex max-[760px]:overflow-x-auto max-[760px]:p-2">
          {SECTIONS.map(({ id, icon: Icon }) => {
            const active = active_section === id
            return (
              <button
                className={`flex w-full cursor-pointer items-center gap-2 border-l-2 px-3 py-2.5 text-left transition-colors max-[760px]:w-auto max-[760px]:shrink-0 max-[760px]:border ${
                  active
                    ? 'border-l-[#c8963c] bg-[#c8963c]/8 text-[#c8963c] max-[760px]:border-[#c8963c]/30'
                    : 'border-l-transparent text-[#6b7280] hover:bg-white/4 hover:text-[#e8e4dc] max-[760px]:border-border'
                }`}
                key={id}
                onClick={() => go(id)}
                type="button"
              >
                <Icon className={active ? 'opacity-80' : 'opacity-40'} size={12} />
                <span className="text-[10px] tracking-[0.15em] uppercase">{text(`gameplay.section_${id}`)}</span>
              </button>
            )
          })}
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto p-6 max-[760px]:p-3" ref={content_ref}>
        <div className="mx-auto max-w-3xl space-y-10">
          <WikiSection id="combat" title={text('gameplay.section_combat')}>
            <Text>{text('gameplay.combat_desc')}</Text>
            <Formula>D = B × (100 + E + P) / 100 + R</Formula>
            <Subheading>{text('gameplay.elements')}</Subheading>
            <div className="grid gap-1 sm:grid-cols-2">
              {[
                ['earth', 'strength'],
                ['fire', 'intelligence'],
                ['water', 'chance'],
                ['air', 'agility'],
              ].map(([element, stat]) => (
                <Fact
                  color={element_colors[element!]}
                  key={element}
                  label={text(`gameplay.element_${element}`)}
                  value={text(`gameplay.stat_${stat}`)}
                />
              ))}
            </div>
            <Subheading>{text('gameplay.critical_hits')}</Subheading>
            <Text>{text('gameplay.crit_desc')}</Text>
            <Formula>C = 1 / max(2, C₀ − Cᵢ)</Formula>
            <Text>{text('gameplay.crit_bonus_desc')}</Text>
            <Subheading>{text('gameplay.blocking')}</Subheading>
            <Text>{text('gameplay.blocking_desc')}</Text>
            <Subheading>{text('gameplay.resistance')}</Subheading>
            <Text>{text('gameplay.resistance_desc')}</Text>
            <Formula>D₂ = floor(D × (100 − min(RES, 50)) / 100)</Formula>
            <Subheading>{text('gameplay.mob_level_bands')}</Subheading>
            <Text>{text('gameplay.mob_level_bands_desc')}</Text>
            <Subheading>{text('gameplay.life_steal')}</Subheading>
            <Text>{text('gameplay.life_steal_desc')}</Text>
            <Formula>H = floor(ΔHP / 2)</Formula>
            <Text>{text('gameplay.life_steal_note')}</Text>
            <Subheading>{text('gameplay.chatiment')}</Subheading>
            <Text>{text('gameplay.chatiment_desc')}</Text>
            <Formula>G = min(ΔHP × S, CAP × S − Gturn) · S = 1 mob, ½ player</Formula>
            <Subheading>{text('gameplay.healing')}</Subheading>
            <Text>{text('gameplay.healing_desc')}</Text>
            <Formula>H = B × (100 + INT) / 100 + H₊</Formula>
          </WikiSection>

          <WikiSection id="leveling" title={text('gameplay.section_leveling')}>
            <Text>{text('gameplay.leveling_desc')}</Text>
            <div className="grid gap-1 sm:grid-cols-2">
              <Fact label={text('gameplay.stat_points')} value={text('gameplay.stat_points_value', { n: 5 })} />
              <Fact label={text('gameplay.spell_points')} value={text('gameplay.spell_points_value', { n: 1 })} />
            </div>
            <Text>{text('gameplay.stat_costs_desc')}</Text>
            <Subheading>{text('gameplay.xp_milestones')}</Subheading>
            <div className="grid gap-1 sm:grid-cols-3">
              {[10, 50, 100].map((level) => (
                <Fact
                  key={level}
                  label={text(`gameplay.level_${level}`)}
                  value={`${xp_for_level(level)?.toLocaleString('en-US')} XP`}
                />
              ))}
            </div>
            <Subheading>{text('gameplay.wisdom_xp')}</Subheading>
            <Text>{text('gameplay.wisdom_xp_desc')}</Text>
            <Formula>XP₂ = XP × (600 + WIS) / 600</Formula>
          </WikiSection>

          <WikiSection id="stats" title={text('gameplay.section_stats')}>
            <div className="grid gap-1 sm:grid-cols-2">
              {['vitality', 'wisdom', 'strength', 'intelligence', 'chance', 'agility'].map((stat) => (
                <Fact key={stat} label={text(`gameplay.stat_${stat}`)} value={text(`gameplay.stat_${stat}_desc`)} />
              ))}
            </div>
            <Subheading>{text('gameplay.derived_formulas')}</Subheading>
            <div className="grid gap-1">
              <Fact label={text('gameplay.max_health')} value="50 + 5 × LVL + VIT" />
              <Fact label={text('gameplay.action_points')} value={String(CONTRACT_CONSTANTS.base_ap)} />
              <Fact label={text('gameplay.movement_points')} value={String(CONTRACT_CONSTANTS.base_mp)} />
              <Fact label={text('level')} value={max_level} />
            </div>
          </WikiSection>

          <WikiSection id="loot" title={text('gameplay.section_loot')}>
            <Text>{text('gameplay.loot_desc')}</Text>
            <Subheading>{text('gameplay.stat_rolling')}</Subheading>
            <Text>{text('gameplay.stat_rolling_desc')}</Text>
            <Subheading>{text('gameplay.archimobs')}</Subheading>
            <Text>{text('gameplay.archimobs_desc')}</Text>
            <Subheading>{text('gameplay.chance_loot')}</Subheading>
            <Text>{text('gameplay.chance_loot_desc')}</Text>
            <Formula>drop = min(100%, authored × mob band × (600 + average team Chance) / 600)</Formula>
            <Subheading>{text('gameplay.mob_loot_band')}</Subheading>
            <Text>{text('gameplay.mob_loot_band_desc')}</Text>
          </WikiSection>

          <WikiSection id="groups" title={text('gameplay.section_groups')}>
            <Fact label={text('gameplay.max_members')} value="6" />
            <Text>{text('gameplay.groups_desc', { max: 6 })}</Text>
            <Subheading>{text('gameplay.groups_xp')}</Subheading>
            <Text>{text('gameplay.groups_xp_desc')}</Text>
            <Formula>
              XP = base-XP pool × party coefficient × level balance × player level / party level × (600 + WIS) / 600
            </Formula>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
              {RETRO_GROUP_XP_TENTHS.map((coefficient, index) => (
                <Fact key={String(coefficient)} label={String(index + 1)} value={`×${Number(coefficient) / 10}`} />
              ))}
            </div>
            <Subheading>{text('gameplay.groups_loot')}</Subheading>
            <Text>{text('gameplay.groups_loot_desc')}</Text>
          </WikiSection>

          <WikiSection id="dungeons" title={text('gameplay.section_dungeons')}>
            <Text>{text('gameplay.dungeons_desc')}</Text>
            <div className="grid gap-1 sm:grid-cols-2">
              <Fact label={text('gameplay.dungeon_entry')} value={text('gameplay.dungeon_entry_value')} />
              <Fact label={text('gameplay.dungeon_instance')} value={text('gameplay.dungeon_instance_value')} />
              <Fact label={text('gameplay.dungeon_completion')} value={text('gameplay.dungeon_completion_value')} />
              <Fact label={text('gameplay.dungeon_reward')} value={text('gameplay.dungeon_reward_value')} />
            </div>
          </WikiSection>

          <WikiSection id="classes" title={text('gameplay.section_classes')}>
            <Text>{text('gameplay.classes_desc')}</Text>
            <div className="grid gap-1 sm:grid-cols-2">
              {encyclopedia_catalog.classes.map((row) => (
                <Fact
                  key={row.id}
                  label={titleize(row.id)}
                  value={text('spells_count', { count: row.spells.length })}
                />
              ))}
            </div>
          </WikiSection>

          <WikiSection id="economy" title={text('gameplay.section_economy')}>
            <Subheading>{text('gameplay.marketplace')}</Subheading>
            <Text>{text('gameplay.marketplace_desc')}</Text>
          </WikiSection>

          <WikiSection id="forgemagie" title={text('gameplay.section_forgemagie')}>
            <Text>{text('gameplay.forgemagie_desc')}</Text>
            {[
              'crushing',
              'rune_tiers',
              'rune_application',
              'success_rate',
              'puits',
              'over_maging',
              'forgemagie_xp',
              'forgemagie_tips',
            ].map((key) => (
              <div className="space-y-2" key={key}>
                <Subheading>{text(`gameplay.${key}`)}</Subheading>
                <Text>{text(`gameplay.${key}_desc`)}</Text>
              </div>
            ))}
          </WikiSection>
        </div>
      </div>
    </div>
  )
}
