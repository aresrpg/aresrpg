// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_power_summary, type ItemPowerStatus } from './item_power.ts'
import type { JsonValue } from './seed_editor.ts'

const status_facts: Readonly<Record<ItemPowerStatus, Readonly<{ label: string; text: string; marker: string }>>> =
  Object.freeze({
    weak: Object.freeze({ label: 'Below corpus p10', text: 'text-amber-400', marker: '#f59e0b' }),
    balanced: Object.freeze({ label: 'Within Retro p10–p90', text: 'text-emerald-400', marker: '#34d399' }),
    high: Object.freeze({ label: 'Above Retro p90', text: 'text-red-400', marker: '#f87171' }),
    beyond: Object.freeze({ label: 'Above observed Retro max', text: 'text-fuchsia-400', marker: '#e879f9' }),
  })

const scale_position = (weight: number, maximum: number): number =>
  (Math.min(Math.max(weight, 0), maximum) / Math.max(maximum, 1)) * 100

const PowerBar = ({
  value,
  p10,
  p90,
  maximum,
  status,
  percentile,
}: Readonly<{
  value: number
  p10: number
  p90: number
  maximum: number
  status: ItemPowerStatus
  percentile?: number
}>) => {
  const facts = status_facts[status]
  const p10_position = percentile === undefined ? scale_position(p10, maximum) : 10
  const p90_position = percentile === undefined ? scale_position(p90, maximum) : 90
  const value_position = percentile === undefined ? scale_position(value, maximum) : percentile
  return (
    <>
      <div className="relative h-3 overflow-hidden bg-red-500/10">
        <div className="absolute inset-y-0 left-0 bg-amber-500/12" style={{ width: `${p10_position}%` }} />
        <div
          className="absolute inset-y-0 bg-emerald-500/16"
          style={{
            left: `${p10_position}%`,
            width: `${p90_position - p10_position}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 transition-[left] duration-300"
          style={{
            backgroundColor: facts.marker,
            boxShadow: `0 0 5px ${facts.marker}`,
            left: `${value_position}%`,
          }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[7px] tracking-[0.14em] uppercase">
        <span className="text-amber-400/65">p10 {p10}</span>
        <span className="text-emerald-400/65">Retro p10–p90</span>
        <span className="text-red-400/65">max {maximum}</span>
      </div>
    </>
  )
}

export const ItemPowerPanel = ({ value }: Readonly<{ value: JsonValue }>) => {
  const power = item_power_summary(value)
  if (!power || power.level <= 0) return null
  const status = status_facts[power.status]
  return (
    <section className="border-l-2 border-[#c8963c]/55 bg-[#c8963c]/[0.025] px-4 py-3" data-item-power="">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[9px] tracking-[0.16em] text-[#c8963c] uppercase">Dofus item power</h2>
          <p className="mt-1 text-[8px] text-[#666b75]">Maximum-roll rune weight · Ares-supported Retro stats</p>
        </div>
        <span className="text-[8px] tracking-[0.12em] text-[#6f747e] uppercase">
          LVL {power.level} · {power.category || '?'}
        </span>
      </div>

      <PowerBar
        maximum={power.corpus_max}
        p10={power.p10}
        p90={power.p90}
        percentile={power.percentile}
        status={power.status}
        value={power.stat_power}
      />

      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-4">
        <div className="grid grid-cols-2 gap-px bg-white/8">
          <div className="bg-surface-low px-2 py-2 text-center">
            <p className="text-[7px] tracking-[0.14em] text-[#a78bfa] uppercase">Authored max power</p>
            <p className="mt-1 text-[9px] tabular-nums text-[#9da1ab]">{power.stat_power}</p>
          </div>
          <div className="bg-surface-low px-2 py-2 text-center">
            <p className="text-[7px] tracking-[0.14em] text-[#c8963c] uppercase">Retro max-roll median</p>
            <p className="mt-1 text-[9px] tabular-nums text-[#d5d0c8]">{power.median}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[8px] tracking-[0.14em] uppercase ${status.text}`}>{status.label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${status.text}`}>
            <span className="mr-1 text-[7px] tracking-[0.14em] uppercase">Retro percentile</span>P{power.percentile}
          </p>
          <p className="mt-1 text-[7px] tabular-nums text-[#666b75]">
            {power.exact_level_power_donors > 0 && (
              <>
                {power.exact_level_power_donors} exact level/power donor
                {power.exact_level_power_donors === 1 ? '' : 's'} ·{' '}
              </>
            )}
            {power.sample_count} {power.comparison} donors · lvl {power.level_min}–{power.level_max}
          </p>
        </div>
      </div>

      {power.weapon && (
        <div className="mt-4 border-t border-white/8 pt-3">
          <div className="mb-2 flex items-end justify-between gap-4">
            <div>
              <p className="text-[8px] tracking-[0.14em] text-[#ef6b6b] uppercase">Weapon output</p>
              <p className="mt-1 text-[7px] text-[#666b75]">Damage stays separate from rune power</p>
            </div>
            <p className={`text-[8px] tracking-[0.12em] uppercase ${status_facts[power.weapon.status].text}`}>
              {status_facts[power.weapon.status].label}
            </p>
          </div>
          <PowerBar
            maximum={power.weapon.average_max}
            p10={power.weapon.average_p10}
            p90={power.weapon.average_p90}
            status={power.weapon.status}
            value={power.weapon.average_per_ap}
          />
          <p className="mt-2 text-[8px] tabular-nums text-[#9da1ab]">
            average/AP {power.weapon.average_per_ap} · maximum/AP {power.weapon.maximum_per_ap} ·{' '}
            {power.weapon.sample_count} {power.weapon.donor_family} donors
          </p>
        </div>
      )}
    </section>
  )
}
