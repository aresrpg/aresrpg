// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The item sheet: one presentation for inventory, recipes, drops, listings and linked items.
// Callers supply translated text and plain numbers; the sheet owns layout and stat identity.

import type { ReactNode } from 'react'

import { resistance_shape, stat_colors, stat_identities } from '../visual_identity.ts'

export type ItemSheetStat = Readonly<{
  key: string
  label: string
  minimum: number
  maximum: number
  delta?: number
}>
export type ItemSheetDamage = Readonly<{ from: number; to: number; color: string; element: string }>
/** Lets an authoring surface wrap one displayed value with its editor. Read-only surfaces omit it. */
export type ItemSheetField = (request: Readonly<{ slot: string; display: ReactNode; class_name?: string }>) => ReactNode

const plain_field: ItemSheetField = ({ display }) => display
const stat_color = (stat: string): string => stat_colors[stat] ?? 'var(--aui-ink)'
// Negative characteristics keep their authored warning red.
const NEGATIVE = '#ff5555'
const signed = (value: number): string => `${value < 0 ? '' : '+'}${value}`

/** A fully negative range reads from its mildest value to its worst. */
export const item_stat_display_range = ({
  minimum,
  maximum,
}: Readonly<{ key?: string; minimum: number; maximum: number }>): readonly [number, number] =>
  minimum < 0 && maximum < 0 ? [maximum, minimum] : [minimum, maximum]

export const StatGlyph = ({ stat }: Readonly<{ stat: string }>) => {
  const identity = stat_identities[stat]
  const color = stat_color(stat)
  return (
    <span className="aui-stat-glyph" style={{ color }}>
      {stat.endsWith('_resistance') ? (
        <svg
          width={19}
          height={19}
          viewBox="0 0 24 24"
          fill="currentColor"
          fillOpacity={0.16}
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={resistance_shape} />
        </svg>
      ) : identity ? (
        <img alt="" src={identity.icon} />
      ) : (
        <i style={{ background: color }} />
      )}
    </span>
  )
}

export const StatDelta = ({ stat, delta = 0 }: Readonly<{ stat: string; delta?: number }>) =>
  delta === 0 ? null : (
    <strong className="aui-stat-delta" data-equipment-delta={stat} data-gain={delta > 0}>
      {delta > 0 ? '+' : '−'}
      {Math.abs(delta)}
    </strong>
  )

const StatRange = ({ stat, range_to }: Readonly<{ stat: ItemSheetStat; range_to: string }>) => {
  const [from, to] = item_stat_display_range(stat)
  const color = stat_color(stat.key)
  return (
    <span className="aui-item-range">
      <span style={{ color: from < 0 ? NEGATIVE : color }}>{signed(from)}</span>
      {from !== to && (
        <>
          <span className="aui-item-quiet"> {range_to} </span>
          <span style={{ color: to < 0 ? NEGATIVE : color }}>{to}</span>
        </>
      )}
    </span>
  )
}

/** One characteristic row. A row with no value and no delta is an authoring placeholder. */
export const ItemStatLine = ({
  stat,
  range_to,
  field = plain_field,
  action,
}: Readonly<{ stat: ItemSheetStat; range_to: string; field?: ItemSheetField; action?: ReactNode }>) => {
  const defined = [stat.minimum, stat.maximum, stat.delta].some(Boolean)
  const slot = `stat:${stat.key}`
  const label = <span className="aui-item-line-label">{stat.label}</span>
  return (
    <div className="aui-item-line" data-item-stat={stat.key} data-empty={defined ? undefined : ''}>
      <StatGlyph stat={stat.key} />
      {defined ? (
        <>
          {field({ slot, display: <StatRange stat={stat} range_to={range_to} /> })}
          {label}
        </>
      ) : (
        field({
          slot,
          class_name: 'aui-item-line-fill',
          display: (
            <>
              {label}
              <span className="aui-item-add">+</span>
            </>
          ),
        })
      )}
      <StatDelta stat={stat.key} delta={stat.delta} />
      {action}
    </div>
  )
}

const ItemDamageLine = ({
  damage,
  index,
  verb,
  field,
  action,
}: Readonly<{ damage: ItemSheetDamage; index: number; verb: string; field: ItemSheetField; action?: ReactNode }>) => (
  <div className="aui-item-damage" data-item-damage={index}>
    {field({
      slot: `damage:${index}`,
      class_name: 'aui-item-damage-fill',
      display: (
        <span className="aui-item-damage-text">
          <span style={{ color: damage.color }}>{damage.from}</span>
          <span className="aui-item-quiet"> - </span>
          <span style={{ color: damage.color }}>{damage.to}</span>
          <span className="aui-item-quiet"> {verb} </span>
          <span style={{ color: damage.color }}>{damage.element}</span>
        </span>
      ),
    })}
    {action}
  </div>
)

export type ItemSheetProps = Readonly<{
  icon: string | null
  name: string
  level_label?: string
  category: Readonly<{ label: string; color: string }>
  description?: string | null
  obtention?: string | null
  labels: Readonly<{ characteristics: string; characteristics_note?: string; damages: string; range_to: string }>
  /** Shown above the characteristics, for example the equipment being replaced. */
  heading?: ReactNode
  rune?: Readonly<{ stat: string; label: string; amount: number }> | null
  damages: readonly ItemSheetDamage[]
  stats: readonly ItemSheetStat[]
  /** Marks the sheet as an authoring surface. */
  editable?: boolean
  field?: ItemSheetField
  stat_action?: (stat: ItemSheetStat) => ReactNode
  damage_action?: (index: number) => ReactNode
  damages_footer?: ReactNode
  stats_footer?: ReactNode
  children?: ReactNode
}>

const ItemSheetHeader = ({
  icon,
  name,
  level_label,
  category,
  description,
  field,
}: Pick<ItemSheetProps, 'icon' | 'name' | 'level_label' | 'category' | 'description'> &
  Readonly<{ field: ItemSheetField }>) => (
  <header className="item-detail-header">
    {icon && <img alt="" className="item-detail-art" src={icon} />}
    <div className="aui-item-id">
      <div className="item-detail-heading">
        {field({
          slot: 'name',
          class_name: 'aui-item-name-fill',
          display: (
            <span className="aui-item-name" data-item-detail-name="">
              {name}
            </span>
          ),
        })}
        {level_label !== undefined &&
          field({
            slot: 'level',
            class_name: 'aui-item-level-fill',
            display: <span className="aui-item-level">{level_label}</span>,
          })}
      </div>
      {field({
        slot: 'category',
        class_name: 'aui-item-category-fill',
        display: (
          <span className="aui-item-category" style={{ color: category.color }}>
            {category.label}
          </span>
        ),
      })}
      {description && <span className="aui-item-description">{description}</span>}
    </div>
  </header>
)

const ItemRuneLine = ({ rune }: Readonly<{ rune: NonNullable<ItemSheetProps['rune']> }>) => (
  <div className="aui-item-line" data-rune-effect="">
    <StatGlyph stat={rune.stat} />
    <span className="aui-item-amount" style={{ color: stat_colors[rune.stat] }}>
      +{rune.amount}
    </span>
    <span className="aui-item-line-label">{rune.label}</span>
  </div>
)

const ItemDamages = ({
  damages,
  verb,
  field,
  damage_action,
  damages_footer,
}: Pick<ItemSheetProps, 'damages' | 'damage_action' | 'damages_footer'> &
  Readonly<{ verb: string; field: ItemSheetField }>) =>
  damages.length > 0 || damages_footer ? (
    <div className="aui-item-damages" data-item-damages="">
      {damages.map((damage, index) => (
        <ItemDamageLine
          action={damage_action?.(index)}
          damage={damage}
          field={field}
          index={index}
          key={`${damage.element}-${index}`}
          verb={verb}
        />
      ))}
      {damages_footer}
    </div>
  ) : null

const ItemStats = ({
  stats,
  range_to,
  field,
  stat_action,
  stats_footer,
}: Pick<ItemSheetProps, 'stats' | 'stat_action' | 'stats_footer'> &
  Readonly<{ range_to: string; field: ItemSheetField }>) =>
  stats.length > 0 || stats_footer ? (
    <div className="aui-item-stats" data-item-stats="">
      <div data-active-item-stats="">
        {stats.map((stat) => (
          <div key={stat.key}>
            <ItemStatLine action={stat_action?.(stat)} field={field} range_to={range_to} stat={stat} />
          </div>
        ))}
      </div>
      {stats_footer}
    </div>
  ) : null

/** The section exists only when something sits under its title. */
const has_characteristics = ({
  heading,
  rune,
  damages,
  stats,
  damages_footer,
  stats_footer,
}: Pick<ItemSheetProps, 'heading' | 'rune' | 'damages' | 'stats' | 'damages_footer' | 'stats_footer'>): boolean =>
  [heading, rune, damages.length, stats.length, damages_footer, stats_footer].some(Boolean)

export const ItemSheet = (props: ItemSheetProps) => {
  const { labels, obtention, rune, editable = false, field = plain_field, children } = props
  return (
    <div className="item-detail-view" data-item-detail-editable={editable ? '' : undefined} data-item-detail-view="">
      <ItemSheetHeader
        category={props.category}
        description={props.description}
        field={field}
        icon={props.icon}
        level_label={props.level_label}
        name={props.name}
      />
      {obtention && <p className="aui-item-obtention">{obtention}</p>}
      {has_characteristics(props) && (
        <section className="aui-item-section">
          <h3 className="item-detail-section-title">{labels.characteristics}</h3>
          {props.heading}
          {labels.characteristics_note && <p className="aui-item-note">{labels.characteristics_note}</p>}
          {rune && <ItemRuneLine rune={rune} />}
          <ItemDamages
            damage_action={props.damage_action}
            damages={props.damages}
            damages_footer={props.damages_footer}
            field={field}
            verb={labels.damages}
          />
          <ItemStats
            field={field}
            range_to={labels.range_to}
            stat_action={props.stat_action}
            stats={props.stats}
            stats_footer={props.stats_footer}
          />
        </section>
      )}
      {children}
    </div>
  )
}
