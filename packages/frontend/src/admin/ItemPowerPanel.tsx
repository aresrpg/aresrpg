// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { item_power_summary } from './item_power.ts'
import type { JsonValue } from './seed_editor.ts'

const status_facts = Object.freeze({
  weak: Object.freeze({ label: 'Too weak', text: 'text-amber-400', marker: '#f59e0b' }),
  balanced: Object.freeze({ label: 'Balanced', text: 'text-emerald-400', marker: '#34d399' }),
  overpowered: Object.freeze({ label: 'Overpowered', text: 'text-red-400', marker: '#f87171' }),
  broken: Object.freeze({ label: 'Beyond corpus', text: 'text-fuchsia-400', marker: '#e879f9' }),
})

const scale_position = (weight: number, hard_max: number): number =>
  (Math.min(Math.max(weight, 0), hard_max) / Math.max(hard_max, 1)) * 100

export const ItemPowerPanel = ({ value }: Readonly<{ value: JsonValue }>) => {
  const power = item_power_summary(value)
  if (!power || power.budget <= 0) return null
  const status = status_facts[power.status]
  const marker = scale_position(power.total_weight, power.hard_max)
  const p10 = scale_position(power.p10, power.hard_max)
  const p90 = scale_position(power.p90, power.hard_max)
  return (
    <section className="border-l-2 border-[#c8963c]/55 bg-[#c8963c]/[0.025] px-4 py-3">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[9px] tracking-[0.16em] text-[#c8963c] uppercase">Dofus item power</h2>
          <p className="mt-1 text-[8px] text-[#666b75]">Donor-fitted level curve · maximum rolls plus weapon damage</p>
        </div>
        <span className="text-[8px] tracking-[0.12em] text-[#6f747e] uppercase">
          LVL {power.level} · {power.category || '?'}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden bg-red-500/10">
        <div className="absolute inset-y-0 left-0 bg-amber-500/12" style={{ width: `${p10}%` }} />
        <div className="absolute inset-y-0 bg-emerald-500/16" style={{ left: `${p10}%`, width: `${p90 - p10}%` }} />
        <div className="absolute inset-y-0 w-px bg-amber-300/40" style={{ left: `${p10}%` }} />
        <div className="absolute inset-y-0 w-px bg-red-300/40" style={{ left: `${p90}%` }} />
        <div
          className="absolute inset-y-0 w-0.5 transition-[left] duration-300"
          style={{ backgroundColor: status.marker, boxShadow: `0 0 5px ${status.marker}`, left: `${marker}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[7px] tracking-[0.14em] uppercase">
        <span className="text-amber-400/65">Under {power.p10}</span>
        <span className="text-emerald-400/65">Donor p10–p90</span>
        <span className="text-red-400/65">Above {power.p90}</span>
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-4">
        <div className="grid grid-cols-3 gap-px bg-white/8">
          <div className="bg-[#0b0c12] px-2 py-2 text-center">
            <p className="text-[7px] tracking-[0.14em] text-[#a78bfa] uppercase">Stats</p>
            <p className="mt-1 text-[9px] tabular-nums text-[#9da1ab]">{power.stat_weight} power</p>
          </div>
          <div className="bg-[#0b0c12] px-2 py-2 text-center">
            <p className="text-[7px] tracking-[0.14em] text-[#ef6b6b] uppercase">Damage</p>
            <p className="mt-1 text-[9px] tabular-nums text-[#9da1ab]">{power.damage_weight} power</p>
          </div>
          <div className="bg-[#0b0c12] px-2 py-2 text-center">
            <p className="text-[7px] tracking-[0.14em] text-[#c8963c] uppercase">Total / budget</p>
            <p className="mt-1 text-[9px] tabular-nums text-[#d5d0c8]">
              {power.total_weight} / {power.budget}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[8px] tracking-[0.14em] uppercase ${status.text}`}>{status.label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${status.text}`}>{power.score}%</p>
          <p className="mt-1 text-[7px] tabular-nums text-[#666b75]">
            p10 {power.p10} · p90 {power.p90}
          </p>
        </div>
      </div>
    </section>
  )
}
