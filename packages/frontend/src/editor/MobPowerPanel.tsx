// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MobPowerSummary } from './mob_power.ts'

const Stat = ({ label, value, color }: Readonly<{ label: string; value: number; color: string }>) => (
  <div className="border border-white/8 bg-black/15 px-3 py-3 text-center">
    <p className="text-[7px] tracking-[0.12em] uppercase" style={{ color }}>
      {label}
    </p>
    <p className="mt-1 text-[13px] font-semibold tabular-nums text-[#e6e0d8]">{value.toLocaleString('en-US')}</p>
  </div>
)

export const MobPowerPanel = ({ reference }: Readonly<{ reference: MobPowerSummary['retro'] }>) => {
  const donor_levels =
    reference.donor_level_min === reference.donor_level_max
      ? `Lv ${reference.donor_level_min}`
      : `Lv ${reference.donor_level_min}–${reference.donor_level_max}`
  const cohort =
    reference.cohort === reference.requested_cohort
      ? reference.cohort
      : `${reference.cohort} fallback for ${reference.requested_cohort}`
  return (
    <section className="border-l-2 border-[#a78bfa]/55 bg-[#a78bfa]/[0.025] px-4 py-3" data-mob-power="">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[9px] tracking-[0.16em] text-[#a78bfa] uppercase">Dofus reference</h2>
        <p className="text-[7px] text-[#666b75]">
          Requested Lv {reference.level} · {cohort} · donors {donor_levels} · {reference.sample_count} grades
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat color="#ef6b78" label="Average HP" value={reference.hp} />
        <Stat color="#65c993" label="Average base XP" value={reference.xp} />
        <Stat color="#e8b44f" label="Average damage" value={reference.damage} />
      </div>
      <p className="mt-2 text-[7px] text-[#5f646e]">
        Base XP is the monster pool before Dofus applies player level, party, wisdom, and star modifiers.
      </p>
    </section>
  )
}
