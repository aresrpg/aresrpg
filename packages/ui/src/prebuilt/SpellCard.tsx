// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The spell card: one presentation for the class grimoire, mob spells, the simulator and authoring.
// Callers supply translated text, plain numbers and the selected rank; the card owns layout.

import { Fragment, type ReactNode } from 'react'

import { Button } from '../components/controls.tsx'

import type { ItemSheetField } from './ItemSheet.tsx'
import { plain_field, SpellEffectList, type SpellEffectListProps, type SpellGlyph } from './SpellEffects.tsx'

export type SpellCardLevel = Readonly<{
  ap_cost: number
  range_min: number
  range_max: number
  crit_1_in: number
  modifiable_range: boolean
  line_of_sight: boolean
  line_launch: boolean
  free_cell: boolean
  casts_per_turn: number
  casts_per_target: number
  cooldown_turns: number
}>

export type SpellCardLabels = Readonly<{
  ap_cost: string
  range: string
  crit_chance: string
  effects: string
  range_modifiability: string
  line_of_sight: string
  cast_line: string
  target_cell_empty: string
  casts_per_turn: string
  casts_per_target: string
  cooldown: string
  unlimited: string
  cooldown_none: string
}>

export type SpellCardIcons = Readonly<{
  ap: SpellGlyph
  range: SpellGlyph
  critical: SpellGlyph
  yes: SpellGlyph
  no: SpellGlyph
}>

export type SpellCardProps = Readonly<{
  name: string
  caster: Readonly<{ label: string; color: string }>
  /** The spell art. Mob spells omit it. */
  art?: ReactNode
  /** The displayed rank, zero-based, with its label and the optional unlock note. */
  rank: Readonly<{ index: number; label: string; unlock?: string }>
  /** One accessible label per rank; selecting a rank is the caller's state. */
  ranks: Readonly<{ labels: readonly string[]; select: (index: number) => void }>
  /** The compact card hides the rank picker. */
  small?: boolean
  level: SpellCardLevel
  labels: SpellCardLabels
  icons: SpellCardIcons
  effects: SpellEffectListProps
  field?: ItemSheetField
}>

// Metric accents are authored per mechanic, not per element.
const AP_COLOR = '#e8b44f'
const RANGE_COLOR = '#67adff'
const CRITICAL_COLOR = '#f0c35a'

type SectionProps = Readonly<Pick<SpellCardProps, 'level' | 'labels' | 'icons'> & { field: ItemSheetField }>

const Metric = ({
  Icon,
  label,
  color,
  children,
}: Readonly<{ Icon: SpellGlyph; label: string; color: string; children: ReactNode }>) => (
  <div className="aui-spell-metric">
    <span className="aui-spell-metric-icon" style={{ borderColor: `${color}55`, backgroundColor: `${color}12`, color }}>
      <Icon size={15} strokeWidth={1.6} />
    </span>
    <span className="aui-spell-metric-text">
      <span className="aui-spell-metric-label">{label}</span>
      <span className="aui-spell-metric-value" style={{ color }}>
        {children}
      </span>
    </span>
  </div>
)

const SpellMetrics = ({ level, labels, icons, field }: SectionProps) => (
  <div className="aui-spell-metrics" data-spell-ap-cost={level.ap_cost}>
    <Metric Icon={icons.ap} color={AP_COLOR} label={labels.ap_cost}>
      {field({ slot: 'ap_cost', display: level.ap_cost })}
    </Metric>
    <Metric Icon={icons.range} color={RANGE_COLOR} label={labels.range}>
      {field({ slot: 'range', class_name: 'aui-spell-range-fill', display: `${level.range_min}–${level.range_max}` })}
    </Metric>
    <Metric Icon={icons.critical} color={CRITICAL_COLOR} label={labels.crit_chance}>
      {field({ slot: 'crit_1_in', display: level.crit_1_in ? `1 / ${level.crit_1_in}` : '—' })}
    </Metric>
  </div>
)

type RuleSlot = 'modifiable_range' | 'line_of_sight' | 'line_launch' | 'free_cell'
type ConstraintSlot = 'casts_per_turn' | 'casts_per_target' | 'cooldown_turns'

const rule_labels = (labels: SpellCardLabels): readonly (readonly [RuleSlot, string])[] => [
  ['modifiable_range', labels.range_modifiability],
  ['line_of_sight', labels.line_of_sight],
  ['line_launch', labels.cast_line],
  ['free_cell', labels.target_cell_empty],
]

const constraint_labels = (labels: SpellCardLabels): readonly (readonly [ConstraintSlot, string, string])[] => [
  ['casts_per_turn', labels.casts_per_turn, labels.unlimited],
  ['casts_per_target', labels.casts_per_target, labels.unlimited],
  ['cooldown_turns', labels.cooldown, labels.cooldown_none],
]

const SpellFacts = ({ level, labels, icons, field }: SectionProps) => (
  <section className="spell-constraints aui-spell-constraints">
    <div className="aui-spell-facts">
      {rule_labels(labels).map(([slot, label]) => (
        <Fragment key={slot}>
          {field({
            slot,
            class_name: 'aui-spell-fact aui-spell-rule',
            display: (
              <div className="spell-rule aui-spell-fact aui-spell-rule">
                <span className="aui-spell-rule-label">{label}</span>
                {level[slot] ? (
                  <icons.yes className="aui-spell-yes" size={13} />
                ) : (
                  <icons.no className="aui-spell-no" size={13} />
                )}
              </div>
            ),
          })}
        </Fragment>
      ))}
    </div>
    <div className="aui-spell-facts">
      {constraint_labels(labels).map(([slot, label, fallback]) => (
        <div className="aui-spell-fact" key={slot}>
          <span className="aui-spell-fact-label">{label}</span>
          <span className="aui-spell-fact-value">{field({ slot, display: level[slot] || fallback })}</span>
        </div>
      ))}
    </div>
  </section>
)

const SpellIdentity = ({
  name,
  caster,
  rank,
  field,
}: Readonly<Pick<SpellCardProps, 'name' | 'caster' | 'rank'> & { field: ItemSheetField }>) => (
  <div className="spell-identity aui-spell-identity">
    {field({ slot: 'name', class_name: 'aui-spell-name-fill', display: <h3 className="aui-spell-name">{name}</h3> })}
    {field({
      slot: 'classe',
      class_name: 'aui-spell-caster-fill',
      display: (
        <p className="spell-caster" style={{ color: caster.color }}>
          {caster.label}
        </p>
      ),
    })}
    <p className="spell-unlock">
      <span>{rank.label}</span>
      {rank.unlock !== undefined && <span>{rank.unlock}</span>}
    </p>
  </div>
)

const RankPicker = ({ rank, ranks }: Readonly<Pick<SpellCardProps, 'rank' | 'ranks'>>) => (
  <nav className="spell-rank-picker" data-spell-level-tabs="">
    {ranks.labels.map((label, index) => (
      <Button
        aria-label={label}
        aria-pressed={index === rank.index}
        className="spell-rank-button"
        key={index}
        onClick={() => ranks.select(index)}
        type="button"
      >
        {index + 1}
      </Button>
    ))}
  </nav>
)

export const SpellCard = (props: SpellCardProps) => {
  const { art, rank, small = false, labels, effects, field = plain_field } = props
  return (
    <article
      className="spell-card aui-spell-card"
      data-spell-detail-card=""
      data-spell-small={small ? '' : undefined}
      data-spell-current-level={rank.index + 1}
    >
      <header className="aui-spell-head">
        {art ? (
          <span className="aui-spell-art" data-spell-art="">
            {art}
          </span>
        ) : null}
        <SpellIdentity caster={props.caster} field={field} name={props.name} rank={rank} />
      </header>

      <section className="aui-spell-body">
        {!small && <RankPicker rank={rank} ranks={props.ranks} />}
        <div className="spell-content aui-spell-content">
          <SpellMetrics field={field} icons={props.icons} labels={labels} level={props.level} />
          <section className="aui-spell-effects-section" data-spell-effects="">
            <h4 className="aui-spell-section-title">{labels.effects}</h4>
            <SpellEffectList {...effects} />
          </section>
          <SpellFacts field={field} icons={props.icons} labels={labels} level={props.level} />
        </div>
      </section>
    </article>
  )
}
