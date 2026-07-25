// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Swords, Sparkles, Zap, Users, TrendingUp, Activity, DoorOpen, Crown, Coins } from 'lucide-react'
import { MAX_MEMBERS } from '@aresrpg/party/reduce'
import sdk_classes from '@aresrpg/sdk/classes'
import { level_to_experience } from '@aresrpg/sdk/experience'
import { SPELL_POINTS_PER_LEVEL, STAT_POINTS_PER_LEVEL } from '@aresrpg/sdk/progression'
import { STATISTICS, get_total_stat } from '@aresrpg/sdk/stats'

// Forgemagie rune catalog — HARDCODED, mirrors packages/move/foundation/sources/rune_catalog.move exactly
// (runes are sealed content, "never admin data" per DECISIONS 2026-07-09 2143-2145). `unit_weight` is the
// retro per-point weight (rune_catalog's UNIT_WEIGHTS ÷ its ×5 WEIGHT_SCALE); ba/pa/ra are the stat points
// a rune of that tier adds (null = no rune exists for that tier). 15 runeable stats -> 35 total (stat,tier)
// entries (10 three-tier stats × 3 + 5 single-tier majors × 1). critical/critical_outcomes carry NO rune at
// all (rune_catalog::RUNEABLE = 0) and are intentionally absent from this table — the frontend's item-mint
// Item-mint stat budgeting uses a DIFFERENT, unrelated weight table — never reuse it here again.
const RUNE_CATALOG = [
  { key: 'stat_vitality', unit_weight: 0.2, ba: 3, pa: 10, ra: 30 },
  { key: 'stat_wisdom', unit_weight: 3, ba: 1, pa: 3, ra: 10 },
  { key: 'stat_strength', unit_weight: 1, ba: 1, pa: 3, ra: 10 },
  { key: 'stat_intelligence', unit_weight: 1, ba: 1, pa: 3, ra: 10 },
  { key: 'stat_chance', unit_weight: 1, ba: 1, pa: 3, ra: 10 },
  { key: 'stat_agility', unit_weight: 1, ba: 1, pa: 3, ra: 10 },
  { key: 'rune_stat_earth_resist', unit_weight: 2, ba: 1, pa: 3, ra: 10 },
  { key: 'rune_stat_fire_resist', unit_weight: 2, ba: 1, pa: 3, ra: 10 },
  { key: 'rune_stat_water_resist', unit_weight: 2, ba: 1, pa: 3, ra: 10 },
  { key: 'rune_stat_air_resist', unit_weight: 2, ba: 1, pa: 3, ra: 10 },
  { key: 'rune_stat_range', unit_weight: 51, ba: 1, pa: null, ra: null },
  { key: 'rune_stat_movement', unit_weight: 90, ba: 1, pa: null, ra: null },
  { key: 'rune_stat_action', unit_weight: 100, ba: 1, pa: null, ra: null },
  { key: 'rune_stat_raw_damage', unit_weight: 20, ba: 1, pa: null, ra: null },
  { key: 'rune_stat_critical_chance', unit_weight: 10, ba: 1, pa: null, ra: null },
] as const

// THE RULEBOOK PUBLISHES NUMBERS, IT DOES NOT OWN THEM (#846). Every figure below is READ from the module the
// game itself reads, so a rebalance can never leave this page lying: the per-level grants are the SDK's
// progression constants (progression_math.move's twin), base AP/MP are the SDK's own empty-character derivation
// (the same one src/simulator/content.js uses), the xp milestones are the SDK curve, the party cap is the party
// reducer's, and the class table is @aresrpg/sdk/classes verbatim. Add a displayed number here only if it has
// no importable home — and then say which module it mirrors.
const BASE_AP = get_total_stat({} as any, STATISTICS.ACTION)
const BASE_MP = get_total_stat({} as any, STATISTICS.MOVEMENT)
const XP_MILESTONE_LEVELS = [10, 50, 100] as const
type SdkClass = { name: string; title: string; health: number; weapon_category: string }
const SDK_CLASSES = Object.values(sdk_classes as Record<string, SdkClass>)

function WikiSection({
  id,
  title,
  refs,
  children,
}: {
  id: string
  title: string
  refs: React.MutableRefObject<Record<string, HTMLDivElement | null>>
  children: React.ReactNode
}) {
  return (
    <div
      id={id}
      ref={(el) => {
        refs.current[id] = el
      }}
      className="flex flex-col gap-3"
    >
      <span className="text-[11px] tracking-[0.3em] uppercase font-semibold text-gradient">{title}</span>
      <div className="w-full h-px" style={{ background: 'rgba(200,150,60,0.15)' }} />
      {children}
    </div>
  )
}

function WikiText({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-relaxed text-text/80">{children}</p>
}

function FormulaBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-2 border border-border text-[9px] tracking-wide text-gold/80"
      style={{ background: 'rgba(255,255,255,0.03)', fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </div>
  )
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-2 py-1" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <span className="text-[9px] tracking-[0.1em] uppercase text-muted">{label}</span>
      <span className="text-[10px]" style={{ color: color || 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  )
}

function ElementBadge({ element, stat, color }: { element: string; stat: string; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border border-border"
      style={{ borderLeft: `2px solid ${color}` }}
    >
      <span
        style={{ width: 8, height: 8, background: color, display: 'inline-block', boxShadow: `0 0 6px ${color}50` }}
      />
      <span className="text-[10px] tracking-[0.1em] uppercase font-semibold" style={{ color }}>
        {element}
      </span>
      <span className="text-[9px] text-muted ml-auto">{stat}</span>
    </div>
  )
}

const GAMEPLAY_SECTIONS = [
  { id: 'combat', label: 'encyclopedia.gameplay.section_combat', icon: Swords },
  { id: 'leveling', label: 'encyclopedia.gameplay.section_leveling', icon: TrendingUp },
  { id: 'stats', label: 'encyclopedia.gameplay.section_stats', icon: Activity },
  { id: 'loot', label: 'encyclopedia.gameplay.section_loot', icon: Sparkles },
  { id: 'groups', label: 'encyclopedia.gameplay.section_groups', icon: Users },
  { id: 'dungeons', label: 'encyclopedia.gameplay.section_dungeons', icon: DoorOpen },
  { id: 'classes-overview', label: 'encyclopedia.gameplay.section_classes', icon: Crown },
  { id: 'economy', label: 'encyclopedia.gameplay.section_economy', icon: Coins },
  { id: 'forgemagie', label: 'encyclopedia.gameplay.section_forgemagie', icon: Zap },
] as const

function GameplayTab({ is_mobile }: { is_mobile: boolean }) {
  const [active_section, set_active_section] = useState('combat')
  const content_ref = useRef<HTMLDivElement>(null)
  const section_refs = useRef<Record<string, HTMLDivElement | null>>({})
  const { t } = useTranslation()

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            set_active_section(entry.target.id)
          }
        }
      },
      {
        root: content_ref.current,
        rootMargin: '-20% 0px -70% 0px',
        threshold: 0,
      }
    )

    for (const section of GAMEPLAY_SECTIONS) {
      const el = section_refs.current[section.id]
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [])

  const scroll_to_section = (id: string) => {
    section_refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Identity, affinity, weapon and base HP are the published class corpus — the affinity/weapon LABELS are the
  // only authored part, keyed off the corpus's own `title`/`weapon_category`.
  const CLASS_DATA = SDK_CLASSES.map((row) => ({
    name: row.name,
    role: t(`encyclopedia.gameplay.role_${row.title.toLowerCase()}`),
    weapon: t(`encyclopedia.gameplay.weapon_${row.weapon_category}`),
    hp: row.health,
  }))

  const gameplay_content = (
    <div ref={content_ref} className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-6'}`}>
      <div className="flex flex-col gap-10 max-w-3xl mx-auto">
        {/* COMBAT */}
        <WikiSection id="combat" title={t('encyclopedia.gameplay.section_combat')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.combat_desc')}</WikiText>
          <FormulaBox>damage = base &times; (100 + elementStat + %damage) / 100 + rawDamage</FormulaBox>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.elements')}
          </span>
          <div className="flex flex-col gap-1">
            <ElementBadge
              element={t('encyclopedia.gameplay.element_earth')}
              stat={t('encyclopedia.gameplay.stat_strength')}
              color="#8b6914"
            />
            <ElementBadge
              element={t('encyclopedia.gameplay.element_fire')}
              stat={t('encyclopedia.gameplay.stat_intelligence')}
              color="#ff4500"
            />
            <ElementBadge
              element={t('encyclopedia.gameplay.element_water')}
              stat={t('encyclopedia.gameplay.stat_chance')}
              color="#1e90ff"
            />
            <ElementBadge
              element={t('encyclopedia.gameplay.element_air')}
              stat={t('encyclopedia.gameplay.stat_agility')}
              color="#01be44"
            />
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.critical_hits')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.crit_desc')}</WikiText>
          <FormulaBox>critChance = 1 / max(2, spellCritBase - criticalHit)</FormulaBox>
          <WikiText>{t('encyclopedia.gameplay.crit_bonus_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.blocking')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.blocking_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.resistance')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.resistance_desc')}</WikiText>
          <FormulaBox>finalDamage = floor(damage &times; max(0, 100 - resistance) / 100)</FormulaBox>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.life_steal')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.life_steal_desc')}</WikiText>
          {/* packages/sim/src/fight_spells.js STEAL ↔ cast.move `heal_caster`: player-side casters only, over the
              health the intended target ACTUALLY lost (a redirected hit returns 0). */}
          <FormulaBox>healed = casterIsPlayer ? floor(targetHealthLost / 2) : 0</FormulaBox>
          <WikiText>{t('encyclopedia.gameplay.life_steal_note')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.healing')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.healing_desc')}</WikiText>
          <FormulaBox>heal = base &times; (100 + intelligence) / 100 + healBonus</FormulaBox>
          <div className="flex flex-col gap-0.5">
            <InfoRow
              label={t('encyclopedia.gameplay.stat_intelligence')}
              value={t('encyclopedia.gameplay.healing_intel_value')}
              color="#ff4500"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.heal_bonus')}
              value={t('encyclopedia.gameplay.heal_bonus_value')}
              color="#ff66b2"
            />
            <InfoRow label={t('encyclopedia.gameplay.mobs')} value={t('encyclopedia.gameplay.healing_mobs_value')} />
          </div>
        </WikiSection>

        {/* LEVELING */}
        <WikiSection id="leveling" title={t('encyclopedia.gameplay.section_leveling')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.leveling_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.points_per_level')}
          </span>
          <div className="flex flex-col gap-0.5">
            <InfoRow
              label={t('encyclopedia.gameplay.stat_points')}
              value={t('encyclopedia.gameplay.stat_points_value', { n: STAT_POINTS_PER_LEVEL })}
              color="#c8963c"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.spell_points')}
              value={t('encyclopedia.gameplay.spell_points_value', { n: SPELL_POINTS_PER_LEVEL })}
              color="#c8963c"
            />
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.xp_milestones')}
          </span>
          <div className="flex flex-col gap-0.5">
            {XP_MILESTONE_LEVELS.map((level) => (
              <InfoRow
                key={level}
                label={t(`encyclopedia.gameplay.level_${level}`)}
                value={`${level_to_experience(level).toLocaleString('en-US')} XP`}
              />
            ))}
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.wisdom_xp')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.wisdom_xp_desc')}</WikiText>
          <FormulaBox>xp &times; (600 + wisdom) / 600</FormulaBox>
        </WikiSection>

        {/* STATS */}
        <WikiSection id="stats" title={t('encyclopedia.gameplay.section_stats')} refs={section_refs}>
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted">
            {t('encyclopedia.gameplay.base_stats')}
          </span>
          <div className="flex flex-col gap-0.5">
            <InfoRow
              label={t('encyclopedia.gameplay.stat_vitality')}
              value={t('encyclopedia.gameplay.stat_vitality_desc')}
              color="#ff66b2"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.stat_wisdom')}
              value={t('encyclopedia.gameplay.stat_wisdom_desc')}
              color="#b366ff"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.stat_strength')}
              value={t('encyclopedia.gameplay.stat_strength_desc')}
              color="#8b6914"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.stat_intelligence')}
              value={t('encyclopedia.gameplay.stat_intelligence_desc')}
              color="#ff4500"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.stat_chance')}
              value={t('encyclopedia.gameplay.stat_chance_desc')}
              color="#1e90ff"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.stat_agility')}
              value={t('encyclopedia.gameplay.stat_agility_desc')}
              color="#01be44"
            />
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-3">
            {t('encyclopedia.gameplay.derived_formulas')}
          </span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] tracking-[0.15em] uppercase text-muted">
                {t('encyclopedia.gameplay.max_health')}
              </span>
              <FormulaBox>floor(classBaseHP + max(0, level - 1) &times; 5 + totalVitality)</FormulaBox>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] tracking-[0.15em] uppercase text-muted">
                {t('encyclopedia.gameplay.action_points')}
              </span>
              <FormulaBox>{BASE_AP} + equipment AP</FormulaBox>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] tracking-[0.15em] uppercase text-muted">
                {t('encyclopedia.gameplay.movement_points')}
              </span>
              <FormulaBox>{BASE_MP} + equipment MP</FormulaBox>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] tracking-[0.15em] uppercase text-muted">
                {t('encyclopedia.gameplay.critical_stat')}
              </span>
              <FormulaBox>criticalHit = equipment.critical</FormulaBox>
            </div>
          </div>
        </WikiSection>

        {/* LOOT & DROPS */}
        <WikiSection id="loot" title={t('encyclopedia.gameplay.section_loot')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.loot_desc')}</WikiText>
          <FormulaBox>
            drops if random(0, 1000000) &lt; chancePPM &nbsp;&middot;&nbsp; qty = random(min, max)
          </FormulaBox>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.stat_rolling')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.stat_rolling_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.archimobs')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.archimobs_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.chance_loot')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.chance_loot_desc')}</WikiText>
          <FormulaBox>dropChance &times; (1 + chance / 700)</FormulaBox>
        </WikiSection>

        {/* GROUPS */}
        <WikiSection id="groups" title={t('encyclopedia.gameplay.section_groups')} refs={section_refs}>
          <div className="flex flex-col gap-0.5">
            <InfoRow label={t('encyclopedia.gameplay.max_members')} value={String(MAX_MEMBERS)} color="#c8963c" />
          </div>
          <WikiText>{t('encyclopedia.gameplay.groups_desc', { max: MAX_MEMBERS })}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.groups_xp')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.groups_xp_desc')}</WikiText>
          <FormulaBox>
            xpShare = totalXp / fighterCount &times; (600 + wisdom) / 600 &times; (100 + aging%) / 100
          </FormulaBox>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.groups_loot')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.groups_loot_desc')}</WikiText>
        </WikiSection>

        {/* DUNGEONS */}
        <WikiSection id="dungeons" title={t('encyclopedia.gameplay.section_dungeons')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.dungeons_desc')}</WikiText>
          <div className="flex flex-col gap-0.5">
            <InfoRow
              label={t('encyclopedia.gameplay.dungeon_entry')}
              value={t('encyclopedia.gameplay.dungeon_entry_value')}
            />
            <InfoRow
              label={t('encyclopedia.gameplay.dungeon_instance')}
              value={t('encyclopedia.gameplay.dungeon_instance_value')}
            />
            <InfoRow
              label={t('encyclopedia.gameplay.dungeon_completion')}
              value={t('encyclopedia.gameplay.dungeon_completion_value')}
            />
            <InfoRow
              label={t('encyclopedia.gameplay.dungeon_reward')}
              value={t('encyclopedia.gameplay.dungeon_reward_value')}
            />
          </div>
        </WikiSection>

        {/* CLASSES OVERVIEW */}
        <WikiSection id="classes-overview" title={t('encyclopedia.gameplay.section_classes')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.classes_desc')}</WikiText>
          <div className="flex flex-col gap-0">
            <div className="grid grid-cols-3 gap-0 px-2 py-1.5" style={{ background: 'rgba(200,150,60,0.06)' }}>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold">
                {t('encyclopedia.gameplay.table_class')}
              </span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold">
                {t('encyclopedia.gameplay.table_weapon')}
              </span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold text-center">
                {t('encyclopedia.gameplay.table_hp')}
              </span>
            </div>
            {CLASS_DATA.map((cls, idx) => (
              <div
                key={cls.name}
                className="grid grid-cols-3 gap-0 px-2 py-1.5"
                style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
              >
                <div className="flex flex-col">
                  <span className="text-[10px] tracking-[0.1em] uppercase text-text">{cls.name}</span>
                  <span className="text-[8px] tracking-[0.1em] uppercase text-muted">{cls.role}</span>
                </div>
                <span className="text-[9px] tracking-[0.1em] uppercase text-muted self-center">{cls.weapon}</span>
                <span className="text-[10px] text-center self-center" style={{ color: '#ff66b2' }}>
                  {cls.hp}
                </span>
              </div>
            ))}
          </div>
        </WikiSection>

        {/* ECONOMY */}
        <WikiSection id="economy" title={t('encyclopedia.gameplay.section_economy')} refs={section_refs}>
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.marketplace')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.marketplace_desc')}</WikiText>
        </WikiSection>

        {/* FORGEMAGIE */}
        <WikiSection id="forgemagie" title={t('encyclopedia.gameplay.section_forgemagie')} refs={section_refs}>
          <WikiText>{t('encyclopedia.gameplay.forgemagie_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.crushing')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.crushing_desc')}</WikiText>
          <FormulaBox>
            rolls &asymp; statValue &times; unitWeight &times; itemLevel &times; taux% / bandDivisor(itemLevel)
          </FormulaBox>
          <WikiText>{t('encyclopedia.gameplay.crushing_tiers_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.rune_tiers')}
          </span>
          <div className="flex flex-col gap-0">
            <InfoRow label="Ba" value={t('encyclopedia.gameplay.rune_ba')} color="#4ade80" />
            <InfoRow label="Pa" value={t('encyclopedia.gameplay.rune_pa')} color="#60a5fa" />
            <InfoRow label="Ra" value={t('encyclopedia.gameplay.rune_ra')} color="#c084fc" />
          </div>
          <WikiText>{t('encyclopedia.gameplay.rune_weight_desc')}</WikiText>
          <div className="flex flex-col gap-0">
            <div className="grid grid-cols-4 gap-0 px-2 py-1.5" style={{ background: 'rgba(200,150,60,0.06)' }}>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold">
                {t('encyclopedia.gameplay.rune_table_stat')}
              </span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold text-center">Ba</span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold text-center">Pa</span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-gold text-center">Ra</span>
            </div>
            {RUNE_CATALOG.map((row, idx) => (
              <div
                key={row.key}
                className="grid grid-cols-4 gap-0 px-2 py-1.5"
                style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}
              >
                <span className="text-[9px] tracking-[0.1em] uppercase text-text">
                  {t(`encyclopedia.gameplay.${row.key}`)}
                </span>
                <span className="text-[10px] text-center self-center text-muted">+{row.ba}</span>
                <span className="text-[10px] text-center self-center text-muted">{row.pa ? `+${row.pa}` : '—'}</span>
                <span className="text-[10px] text-center self-center text-muted">{row.ra ? `+${row.ra}` : '—'}</span>
              </div>
            ))}
          </div>
          <WikiText>{t('encyclopedia.gameplay.rune_table_note')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.stat_unit_weights')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.stat_unit_weights_desc')}</WikiText>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0">
            {[...RUNE_CATALOG]
              .sort((a, b) => b.unit_weight - a.unit_weight)
              .map((row) => (
                <InfoRow key={row.key} label={t(`encyclopedia.gameplay.${row.key}`)} value={String(row.unit_weight)} />
              ))}
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.rune_application')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.rune_application_desc')}</WikiText>
          <div className="flex flex-col gap-0">
            <InfoRow
              label={t('encyclopedia.gameplay.outcome_critical_success')}
              value={t('encyclopedia.gameplay.outcome_critical_success_desc')}
              color="#4ade80"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.outcome_neutral')}
              value={t('encyclopedia.gameplay.outcome_neutral_desc')}
              color="#fbbf24"
            />
            <InfoRow
              label={t('encyclopedia.gameplay.outcome_critical_failure')}
              value={t('encyclopedia.gameplay.outcome_critical_failure_desc')}
              color="#ef4444"
            />
          </div>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.success_rate')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.success_rate_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.puits')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.puits_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.over_maging')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.over_maging_desc')}</WikiText>
          <FormulaBox>maxOverMage = floor(101 / statUnitWeight)</FormulaBox>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.forgemagie_tips')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.forgemagie_tips_desc')}</WikiText>

          <span className="text-[9px] tracking-[0.2em] uppercase text-muted mt-2">
            {t('encyclopedia.gameplay.forgemagie_xp')}
          </span>
          <WikiText>{t('encyclopedia.gameplay.forgemagie_xp_desc')}</WikiText>
          <FormulaBox>xp = max(1, runeWeight &times; (1 + itemLevel / 50) &times; tierMultiplier)</FormulaBox>
        </WikiSection>
      </div>
    </div>
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex overflow-x-auto border-b border-border px-2 py-2 gap-1 shrink-0">
          {GAMEPLAY_SECTIONS.map((section) => {
            const is_active = active_section === section.id
            const Icon = section.icon
            return (
              <button
                type="button"
                key={section.id}
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[8px] tracking-[0.1em] uppercase cursor-pointer transition-colors ${is_active ? 'text-gold bg-gold/10 border border-gold/30' : 'text-muted border border-border hover:text-text'}`}
                onClick={() => scroll_to_section(section.id)}
              >
                <Icon size={10} style={{ opacity: is_active ? 0.8 : 0.4 }} />
                {t(section.label)}
              </button>
            )
          })}
        </div>
        {gameplay_content}
      </div>
    )
  }

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      {/* Left sidebar */}
      <div className="flex flex-col gap-0 border-r border-border" style={{ width: 300, minWidth: 300 }}>
        <div className="px-3 py-3 border-b border-border">
          <span className="text-[9px] tracking-[0.25em] uppercase text-muted">
            {t('encyclopedia.gameplay.game_mechanics')}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {GAMEPLAY_SECTIONS.map((section) => {
            const is_active = active_section === section.id
            const Icon = section.icon
            return (
              <div
                key={section.id}
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                style={{
                  borderLeft: is_active ? '2px solid var(--color-gold)' : '2px solid transparent',
                  background: is_active ? 'rgba(200,150,60,0.08)' : 'transparent',
                }}
                onClick={() => scroll_to_section(section.id)}
                onMouseEnter={(e) => {
                  if (!is_active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = is_active
                    ? 'rgba(200,150,60,0.08)'
                    : 'transparent'
                }}
              >
                <Icon
                  size={12}
                  style={{ opacity: is_active ? 0.8 : 0.4 }}
                  className={is_active ? 'text-gold' : 'text-muted'}
                />
                <span className={`text-[10px] tracking-[0.15em] uppercase ${is_active ? 'text-gold' : 'text-muted'}`}>
                  {t(section.label)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {gameplay_content}
    </div>
  )
}

export { GameplayTab }
