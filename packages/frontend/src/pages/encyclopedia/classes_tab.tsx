// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Heart, ArrowLeft } from 'lucide-react'
import { spell_icon_url } from '@aresrpg/sdk/jobs'

import { ELEMENT_COLORS } from '../../components/entity_display'
import { use_template_t } from '../../i18n/template_t'
import { class_spells } from '../../game/screens/hud/fight-spells.js'
import { seed_effect_parts, seed_effect_value, is_area_effect } from '../../game/screens/hud/seed-effect-line.js'
import { EffectLine } from '../../game/screens/hud/EffectLine.jsx'

const DAMAGE_KINDS = new Set(['DAMAGE', 'APPLY_DOT', 'LIFE_STEAL', 'PUNISHMENT', 'CASTER_DAMAGE'])
const ZONE_SHAPE_KEYS: Record<string, string> = {
  point: 'encyclopedia.aoe_shape.point',
  circle: 'encyclopedia.aoe_shape.circle',
  cross: 'encyclopedia.aoe_shape.cross',
  line: 'encyclopedia.aoe_shape.line',
  tbar: 'encyclopedia.aoe_shape.tbar',
  ring: 'encyclopedia.aoe_shape.ring',
  allmap: 'encyclopedia.aoe_shape.allmap',
  cone: 'encyclopedia.aoe_shape.cone',
}

type Translate = (key: string, options?: Record<string, unknown>) => unknown

const finite_number = (value: unknown) => {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const crit_effect_for = (level: any, effect: any, index: number) => {
  const crit_effects = Array.isArray(level?.crit_effects) ? level.crit_effects : []
  const indexed = crit_effects[index]
  if (indexed && String(indexed.kind) === String(effect.kind)) return indexed
  return crit_effects.find((candidate: any) => String(candidate.kind) === String(effect.kind)) ?? null
}

const encyclopedia_effect_parts = (t: Translate, effect: any, crit_effect: any) => {
  if (!DAMAGE_KINDS.has(effect.kind)) return seed_effect_parts(t as any, effect)
  const critical_damage = crit_effect ? seed_effect_value(t as any, { ...effect, ...crit_effect }) : undefined
  return seed_effect_parts(t as any, { ...effect, crit_base: critical_damage })
}

const spell_zone_labels = (t: Translate, level: any) => {
  const effects = [
    ...(Array.isArray(level?.effects) ? level.effects : []),
    ...(Array.isArray(level?.crit_effects) ? level.crit_effects : []),
  ]
  const labels = effects.flatMap((effect: any) => {
    const shape = effect?.zone?.shape
    const size = finite_number(effect?.zone?.size)
    if (shape == null || size == null) return []
    // A single-cell zone (size 0 — see is_area_effect) is never a real AoE, never shown.
    if (!is_area_effect(String(shape).toUpperCase(), size)) return []
    const key = ZONE_SHAPE_KEYS[String(shape).toLowerCase()]
    return key ? [String(t(key, { size }))] : []
  })
  return [...new Set(labels)]
}

// §14 SPELL DETAIL — renders a MINTED SpellTemplate's on-chain facts: name / unlock level / element, then EVERY
// on-chain field of each SpellLevel — AP, range (+ whether +Range gear extends it), casts per turn/target,
// cooldown, targeting rules (line of sight, empty-cell-only, straight-line-only), the effect list, and — when
// the level can crit at all (crit_rate > 0) — a CRITICAL box with the crit chance (per-effect crit VALUES ride
// each effect line's own `crit N` meta — one home, no duplicate list). The data is the chain-truth row from
// fight-spells.js (the act_cast target's own SpellLevels, 1:1 with aresrpg_foundation::spell_effect::
// SpellLevel/Effect) — so nothing here is fabricated. Content audit (S-64): AoE/casts-per-turn/empty-cell/crit
// were on-chain but unsurfaced; class "passives" were invented UI content with zero Move backing — deleted.
// Display spec (2026-07-13): effects render as compact LINES (the shared EffectLine + seed_effect_parts
// grammar — the SAME renderer the grimoire uses), never per-effect card boxes.

// One home for the small bordered stat tile the AP/RANGE/CASTS/COOLDOWN/TARGETING rows all use.
function StatChip({
  label,
  value,
  gold,
  note,
  muted,
  data_name,
}: {
  label: string
  value: React.ReactNode
  gold?: boolean
  note?: string | null
  muted?: boolean
  data_name?: string
}) {
  return (
    <div
      className={`flex-1 flex flex-col gap-0.5 px-3 py-2 border border-border ${muted ? 'opacity-40' : ''}`}
      style={{ background: 'rgba(255,255,255,0.02)' }}
      aria-disabled={muted || undefined}
      data-muted={muted ? 'true' : undefined}
      data-stat-chip={data_name}
    >
      <span className="text-[8px] tracking-[0.15em] uppercase text-muted">{label}</span>
      <span className={`text-[11px] font-semibold ${gold ? 'text-gold' : 'text-text'}`}>{value}</span>
      {note && <span className="text-[7px] tracking-[0.1em] uppercase text-muted italic mt-0.5">{note}</span>}
    </div>
  )
}

function SpellDetail({ spell }: { spell: any }) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const levels: any[] = spell.levels ?? []
  const [active_idx, set_active_idx] = useState(0)
  // Switching spells (Ember Strike L3 → Guardian Mend) must not carry the old level tab forward — each newly
  // selected spell's own level 1 is the honest starting view. Keyed by name_key (the stable spell identity
  // used everywhere else in this file for selection/list keys), not the `spell` object reference, which can
  // change shape across re-renders without the selected spell actually changing.
  useEffect(() => {
    set_active_idx(0)
  }, [spell.name_key])
  const idx = active_idx < levels.length ? active_idx : 0
  const lvl = levels[idx] ?? null
  const spell_element = spell.element ? String(spell.element).toLowerCase() : null
  const self_cast = Array.isArray(lvl?.range) && finite_number(lvl.range[0]) === 0 && finite_number(lvl.range[1]) === 0
  const zone_labels = lvl ? spell_zone_labels(t as Translate, lvl) : []

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 w-[78px] h-[78px] border border-gold/30 p-[3px]"
          style={{ background: 'rgba(200,150,60,0.06)', boxShadow: '0 0 16px rgba(200,150,60,0.08)' }}
        >
          <img
            src={spell_icon_url(spell.name_key) ?? undefined}
            alt=""
            className="w-[72px] h-[72px] object-cover"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-[14px] tracking-[0.2em] uppercase font-semibold text-gradient">
            {tt(spell, 'name')}
          </span>
          <span className="text-[8px] tracking-[0.15em] uppercase text-muted">
            {t('encyclopedia.unlocks_at_level', { level: spell.unlock_level })}
          </span>
          {spell_element && (
            <span
              className="text-[8px] tracking-[0.15em] uppercase"
              style={{ color: ELEMENT_COLORS[spell_element] || 'var(--color-muted)' }}
            >
              {t(`encyclopedia.element.${spell_element}`, spell.element) as string}
            </span>
          )}
        </div>
      </div>

      {/* Level buttons (the spell's own on-chain SpellLevels) */}
      {levels.length > 1 && (
        <div className="flex flex-col gap-1">
          <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('encyclopedia.level')}</span>
          <div className="flex gap-0">
            {levels.map((_lvl: any, i: number) => {
              const is_active = idx === i
              return (
                <div
                  key={i}
                  className={`flex-1 py-1.5 text-[9px] tracking-wide uppercase border transition-all cursor-pointer text-center ${
                    is_active
                      ? 'bg-gold/20 border-gold text-gold'
                      : 'border-border text-muted hover:border-gold/30 hover:text-text'
                  }`}
                  onClick={() => set_active_idx(i)}
                >
                  {i + 1}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats row — AP + range (chain: SpellLevel.ap_cost / range_min / range_max / modifiable_range) */}
      {lvl && (
        <div className="flex gap-2 flex-wrap">
          <StatChip label={t('encyclopedia.ap_cost')} value={lvl.ap ?? 0} />
          {Array.isArray(lvl.range) && (
            <StatChip
              label={t('encyclopedia.range')}
              value={`${lvl.range[0]}–${lvl.range[1]}`}
              gold
              note={
                self_cast
                  ? (t('encyclopedia.self_cast') as string)
                  : lvl.modifiable_range
                    ? (t('encyclopedia.range_extendable') as string)
                    : null
              }
              data_name="range"
            />
          )}
        </div>
      )}

      {/* Casts / cooldown row (chain: casts_per_turn / casts_per_target / cooldown_turns) */}
      {lvl && (
        <div className="flex gap-2 flex-wrap">
          <StatChip
            label={t('encyclopedia.casts_per_turn')}
            value={lvl.casts_per_turn >= 255 ? (t('encyclopedia.unlimited') as string) : (lvl.casts_per_turn ?? 0)}
          />
          <StatChip
            label={t('encyclopedia.casts_per_target')}
            value={lvl.casts_per_target >= 255 ? (t('encyclopedia.unlimited') as string) : (lvl.casts_per_target ?? 0)}
          />
          <StatChip
            label={t('encyclopedia.cooldown')}
            value={
              lvl.cooldown > 0
                ? (t('encyclopedia.turns_value', { n: lvl.cooldown }) as string)
                : (t('encyclopedia.cooldown_none') as string)
            }
          />
        </div>
      )}

      {/* Targeting (chain: line_of_sight / free_cell / line_launch — the "empty cell or not / LOS" gap) */}
      {lvl && (
        <div className="flex flex-col gap-1">
          <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('encyclopedia.targeting')}</span>
          <div className="flex gap-2 flex-wrap" data-targeting-relevance={self_cast ? 'irrelevant' : 'active'}>
            <StatChip
              label={t('encyclopedia.line_of_sight')}
              value={
                self_cast
                  ? '—'
                  : (t(lvl.line_of_sight ? 'encyclopedia.los_required' : 'encyclopedia.los_not_required') as string)
              }
              muted={self_cast}
              data_name="line-of-sight"
            />
            <StatChip
              label={t('encyclopedia.target_cell')}
              value={
                self_cast
                  ? '—'
                  : (t(lvl.free_cell ? 'encyclopedia.target_cell_empty' : 'encyclopedia.target_cell_any') as string)
              }
              muted={self_cast}
              data_name="target-cell"
            />
            <StatChip
              label={t('encyclopedia.cast_line')}
              value={
                self_cast
                  ? '—'
                  : (t(lvl.linear ? 'encyclopedia.cast_line_straight' : 'encyclopedia.cast_line_free') as string)
              }
              muted={self_cast}
              data_name="cast-line"
            />
            {zone_labels.length > 0 && (
              <StatChip label={t('encyclopedia.effect_zone')} value={zone_labels.join(' · ')} data_name="effect-zone" />
            )}
          </div>
        </div>
      )}

      {/* Effects — compact LINES (no cards, just lines): the SAME shared EffectLine +
          seed_effect_parts grammar the grimoire renders, inside ONE thin left-bordered group (the accent bar
          survives as a group border, never per-effect boxes). Per-effect crit values ride each line's own
          `crit N` meta; AoE/duration/chance ride the meta too — only when informative. */}
      {lvl && Array.isArray(lvl.effects) && lvl.effects.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[8px] tracking-[0.2em] uppercase text-muted">{t('encyclopedia.effects')}</span>
          <div className="flex flex-col gap-1.5 py-1.5 pl-2.5" style={{ borderLeft: '2px solid var(--color-border)' }}>
            {lvl.effects.map((eff: any, i: number) => (
              <EffectLine key={i} view={encyclopedia_effect_parts(t as Translate, eff, crit_effect_for(lvl, eff, i))} />
            ))}
          </div>
        </div>
      )}

      {/* Critical — only when this level can crit at all (chain: crit_rate > 0, cast.move's own gate). The
          crit CHANCE lives here; the per-effect crit VALUES ride each effect line's `crit N` meta above (one
          home — the old duplicate on-crit list is gone). */}
      {lvl && lvl.crit_rate > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-gold">
            {t('encyclopedia.critical')}
          </span>
          <div
            className="border border-gold/30 px-3 py-2.5 flex flex-col gap-0.5"
            style={{ background: 'rgba(200,150,60,0.06)' }}
          >
            <span className="text-[8px] tracking-[0.15em] uppercase text-muted">{t('encyclopedia.crit_chance')}</span>
            <span className="text-[11px] font-semibold text-gold">
              {t('encyclopedia.crit_chance_value', { n: lvl.crit_rate })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function ClassesTab({
  selected_class_id,
  on_select_class,
  on_navigate_to_item,
  classes,
  is_mobile,
}: {
  selected_class_id: string | null
  on_select_class: (id: string) => void
  on_navigate_to_item: (id: string) => void
  classes: any[]
  is_mobile: boolean
}) {
  const { t } = useTranslation()
  const tt = use_template_t()

  const selected_class = useMemo(() => {
    if (!selected_class_id) return null
    return classes.find((c: any) => c.id === selected_class_id) || null
  }, [selected_class_id, classes])

  // §14: a class's spell deck is ONLY its minted SpellTemplates — resolved from the on-chain seed manifest by
  // fight-spells.js (each row carries the act_cast SpellTemplate object id + its levels). A class with none
  // minted resolves to [] → the honest "no spells minted" state below, never a seed-invented deck.
  const spells: any[] = useMemo(() => (selected_class ? class_spells(selected_class.id) : []), [selected_class])
  const [selected_spell_key, set_selected_spell_key] = useState<string | null>(null)

  useEffect(() => {
    if (spells.length && !spells.find((s: any) => s.name_key === selected_spell_key)) {
      set_selected_spell_key(spells[0].name_key)
    }
  }, [spells, selected_spell_key])

  const selected_spell = spells.find((s: any) => s.name_key === selected_spell_key) || null

  const classes_list_panel = (
    <div
      className={`flex flex-col gap-0 ${is_mobile ? 'flex-1 min-h-0 overflow-y-auto' : 'border-r border-border'}`}
      style={is_mobile ? undefined : { width: 300, minWidth: 300 }}
    >
      {classes.map((cls: any, idx: number) => {
        const is_selected = selected_class_id === cls.id
        const is_draft = cls.draft === true || cls.draft === 'true'
        return (
          <div
            key={cls.id}
            className={`flex flex-col gap-0.5 px-3 py-3 ${is_draft ? 'cursor-default' : 'cursor-pointer'}`}
            style={{
              borderLeft: is_selected && !is_draft ? '2px solid var(--color-gold)' : '2px solid transparent',
              background:
                is_selected && !is_draft
                  ? 'rgba(200,150,60,0.08)'
                  : idx % 2 === 1
                    ? 'rgba(255,255,255,0.02)'
                    : 'transparent',
              opacity: is_draft ? 0.65 : 1,
            }}
            onClick={() => {
              if (!is_draft) on_select_class(cls.id)
            }}
            onMouseEnter={(e) => {
              if (!is_selected && !is_draft)
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              if (!is_selected && !is_draft)
                (e.currentTarget as HTMLElement).style.background =
                  idx % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent'
            }}
          >
            <span
              className={`text-[11px] tracking-[0.15em] uppercase font-semibold ${is_draft ? 'text-muted' : 'text-gradient'}`}
            >
              {cls.displayName || cls.id}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[8px] tracking-[0.1em] uppercase text-muted">
                {t(`simulator.classes.${cls.id}.title`, cls.title) as string}
              </span>
              {is_draft && (
                <span className="text-[8px] tracking-[0.15em] uppercase text-muted border border-muted/30 px-2 py-0.5">
                  {t('encyclopedia.coming_soon')}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )

  const spell_viewer =
    spells.length === 0 ? (
      <div
        className="flex flex-col items-center justify-center gap-2 py-10 border border-border text-muted"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <Sparkles size={18} style={{ opacity: 0.2 }} />
        <span className="text-[9px] tracking-[0.2em] uppercase">{t('encyclopedia.no_spells_minted')}</span>
      </div>
    ) : is_mobile ? (
      <div className="flex flex-col gap-2 border border-border" style={{ minHeight: 200 }}>
        <div className="flex overflow-x-auto border-b border-border p-2 gap-2">
          {spells.map((spell: any) => {
            const is_sel = selected_spell_key === spell.name_key
            return (
              <button
                type="button"
                key={spell.name_key}
                className={`shrink-0 flex items-center gap-1.5 px-2 py-1.5 text-[8px] tracking-[0.1em] uppercase cursor-pointer transition-colors ${is_sel ? 'text-gold bg-gold/10 border border-gold/30' : 'text-muted border border-border hover:text-text'}`}
                onClick={() => set_selected_spell_key(spell.name_key)}
              >
                <img
                  src={spell_icon_url(spell.name_key) ?? undefined}
                  alt=""
                  className="w-4 h-4 shrink-0 object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
                {tt(spell, 'name')}
              </button>
            )
          })}
        </div>
        <div className="p-3">{selected_spell ? <SpellDetail spell={selected_spell} /> : null}</div>
      </div>
    ) : (
      <div className="flex gap-0 border border-border" style={{ minHeight: 300 }}>
        {/* Spell list - left */}
        <div className="flex flex-col border-r border-border" style={{ width: 160, minWidth: 160 }}>
          {spells.map((spell: any) => {
            const is_sel = selected_spell_key === spell.name_key
            return (
              <div
                key={spell.name_key}
                className="flex items-center gap-2 px-2.5 py-2 cursor-pointer transition-colors"
                style={{
                  borderLeft: is_sel ? '2px solid var(--color-gold)' : '2px solid transparent',
                  background: is_sel ? 'rgba(200,150,60,0.08)' : 'transparent',
                }}
                onClick={() => set_selected_spell_key(spell.name_key)}
                onMouseEnter={(e) => {
                  if (!is_sel) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={(e) => {
                  if (!is_sel) (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <img
                  src={spell_icon_url(spell.name_key) ?? undefined}
                  alt=""
                  className="w-5 h-5 shrink-0 object-cover"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
                <span
                  className={`text-[9px] tracking-[0.1em] uppercase truncate ${is_sel ? 'text-gold' : 'text-text'}`}
                >
                  {tt(spell, 'name')}
                </span>
              </div>
            )
          })}
        </div>
        {/* Spell detail - right */}
        <div className="flex-1 p-4">{selected_spell ? <SpellDetail spell={selected_spell} /> : null}</div>
      </div>
    )

  const classes_detail_panel = (
    <div className={`flex-1 overflow-y-auto ${is_mobile ? 'p-3' : 'p-4 pt-14'}`}>
      {!selected_class ? (
        <div className="flex flex-col items-center justify-center gap-3 h-full text-muted">
          <Sparkles size={24} style={{ opacity: 0.2 }} />
          <span className="text-[10px] tracking-[0.2em] uppercase">{t('encyclopedia.select_class')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
          <div className="flex flex-col gap-1">
            <span className="text-[14px] tracking-[0.25em] uppercase font-semibold text-gradient">
              {t(`simulator.classes.${selected_class.id}.title`, selected_class.displayName) as string}
            </span>
            <span className="text-[10px] tracking-[0.15em] uppercase text-muted">
              {t(`simulator.classes.${selected_class.id}.title`, selected_class.title) as string}
            </span>
          </div>
          <div className={`flex gap-3 ${is_mobile ? 'flex-wrap' : ''}`}>
            <div className="flex flex-col items-center gap-1 px-4 py-2.5 border border-border">
              <div className="flex items-center gap-1">
                <Heart size={10} className="opacity-40" />
                <span className="text-gold text-[13px] font-semibold">{selected_class.health}</span>
              </div>
              <span className="text-[8px] tracking-[0.15em] uppercase text-muted">{t('encyclopedia.health')}</span>
            </div>
          </div>
          <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="flex flex-col gap-2">
            <span className="text-[9px] tracking-[0.25em] uppercase font-semibold text-muted">
              {t('encyclopedia.spells_count', { count: spells.length })}
            </span>
            {spell_viewer}
          </div>
        </div>
      )}
    </div>
  )

  if (is_mobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {selected_class ? (
          <>
            <button
              type="button"
              onClick={() => on_select_class(null as any)}
              className="flex items-center gap-2 px-3 py-2 text-muted text-[10px] tracking-[0.15em] uppercase hover:text-gold transition-colors border-b border-border shrink-0 cursor-pointer"
            >
              <ArrowLeft size={12} /> {t('encyclopedia.back_to_list')}
            </button>
            {classes_detail_panel}
          </>
        ) : (
          classes_list_panel
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-0 flex-1 min-h-0">
      {classes_list_panel}
      {classes_detail_panel}
    </div>
  )
}

export { ClassesTab, SpellDetail }
