// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established mob combat-stat cards, shared by authored editing and player-facing details.

import { TrendingUp, type LucideIcon } from 'lucide-react'

import { stat_identities } from '../visual_identity.ts'

export type MobCoreStat = 'hp' | 'ap' | 'mp' | 'agility' | 'wisdom' | 'xp'

type MobStatIdentity = Readonly<{
  key: MobCoreStat
  label: string
  color: string
  icon?: LucideIcon
  image?: string
}>

const mob_stat_identities: readonly MobStatIdentity[] = Object.freeze([
  { key: 'hp', label: 'HP', color: '#ef6b78', image: stat_identities.hp!.icon },
  { key: 'ap', label: 'AP', color: '#e8b44f', image: stat_identities.ap!.icon },
  { key: 'mp', label: 'MP', color: '#42c7c7', image: stat_identities.mp!.icon },
  { key: 'agility', label: 'Agility', color: stat_identities.agility!.tint, image: stat_identities.agility!.icon },
  { key: 'wisdom', label: 'Wisdom', color: stat_identities.wisdom!.tint, image: stat_identities.wisdom!.icon },
  { key: 'xp', label: 'XP reward', color: '#65c993', icon: TrendingUp },
])

export const MobCoreStats = ({
  values,
  labels,
  change,
}: Readonly<{
  values: Readonly<Partial<Record<MobCoreStat, unknown>>>
  labels?: Readonly<Partial<Record<MobCoreStat, string>>>
  change?: (stat: MobCoreStat, value: number) => void
}>) => (
  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {mob_stat_identities.map(({ key, label: fallback_label, color, icon: Icon, image }) => {
      const label = labels?.[key] ?? fallback_label
      const value = typeof values[key] === 'number' ? values[key] : 0
      return (
        <div
          className="flex min-h-14 items-center gap-3 border border-white/8 bg-white/[0.018] px-3 py-2"
          data-mob-stat-icon={key}
          key={key}
        >
          <span
            className="grid size-8 shrink-0 place-items-center border"
            style={{ borderColor: `${color}55`, backgroundColor: `${color}12`, color }}
          >
            {image ? <img alt="" className="size-6 object-contain" src={image} /> : Icon ? <Icon size={16} /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[7px] tracking-[0.13em] text-[#737883] uppercase">{label}</span>
            {change ? (
              <input
                aria-label={label}
                className="mt-1 h-7 w-full max-w-28 border border-white/10 bg-[#090a10] px-2 text-right text-[11px] font-semibold tabular-nums outline-none focus:border-[#4a9eff]/60"
                onChange={(event) => change(key, Number(event.target.value))}
                style={{ color }}
                type="number"
                value={value}
              />
            ) : (
              <span className="mt-1 block text-[12px] font-semibold tabular-nums" style={{ color }}>
                {value.toLocaleString('en-US')}
              </span>
            )}
          </span>
        </div>
      )
    })}
  </div>
)
