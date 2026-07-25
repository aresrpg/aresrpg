// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// STAT IDENTITY — the ONE home for "what a characteristic looks and reads like": its icon art, its tint, its
// localized label and its sim-truth description, plus the row-identity fragment every stat surface renders.
//
// Extracted VERBATIM out of Stats.jsx (the character panel), which now re-composes it. The reason is the
// no-divergence law: the simulator's build editor allocates the same six characteristics and must show the
// same icons, the same tints and the same copy — a second local table would be a second truth about what
// "Strength" looks like. Presentation only: no store, no chain read, so it mounts anywhere (the panel, the
// simulator modal, a test) with nothing but `t`.

import { STATISTICS } from '@aresrpg/sdk/stats'

import { Tooltip } from './Tooltip.jsx'
import vitality_icon from '../../assets/statistics/vitality.png'
import wisdom_icon from '../../assets/statistics/wisdom.png'
import strength_icon from '../../assets/statistics/strength.png'
import intelligence_icon from '../../assets/statistics/intelligence.png'
import chance_icon from '../../assets/statistics/chance.png'
import agility_icon from '../../assets/statistics/agility.png'
import './hud-panels.css'

/** Move order differs from display order: Agility=4, Chance=5. */
export const STAT_INDEX = Object.freeze({
  [STATISTICS.VITALITY]: 0,
  [STATISTICS.WISDOM]: 1,
  [STATISTICS.STRENGTH]: 2,
  [STATISTICS.INTELLIGENCE]: 3,
  [STATISTICS.AGILITY]: 4,
  [STATISTICS.CHANCE]: 5,
})

/** The six allocatable characteristics, in DISPLAY order, with their art + tint.
 *  @type {{ key: string, stat: number, icon: string, tint: string }[]} */
export const PRIMARY_STATS = [
  { key: STATISTICS.VITALITY, stat: STAT_INDEX.vitality, icon: vitality_icon, tint: '#ef5350' },
  { key: STATISTICS.WISDOM, stat: STAT_INDEX.wisdom, icon: wisdom_icon, tint: '#b07cff' },
  { key: STATISTICS.STRENGTH, stat: STAT_INDEX.strength, icon: strength_icon, tint: '#c9905a' },
  {
    key: STATISTICS.INTELLIGENCE,
    stat: STAT_INDEX.intelligence,
    icon: intelligence_icon,
    tint: '#5db4ff',
  },
  { key: STATISTICS.CHANCE, stat: STAT_INDEX.chance, icon: chance_icon, tint: '#4fd6a0' },
  { key: STATISTICS.AGILITY, stat: STAT_INDEX.agility, icon: agility_icon, tint: '#ffce85' },
]

/** The art + tint for one characteristic key, or null for a key with no authored identity. */
export const stat_identity = (/** @type {string} */ key) => PRIMARY_STATS.find((row) => row.key === key) ?? null

/** label + sim-truth description (issue #371) per stat row, primary or secondary — literal t() calls keep
 * the 6-locale coverage gate authoritative; formula citations (file:line) live in the PR body. */
export const stat_text = (/** @type {any} */ t, /** @type {string} */ key) => {
  switch (key) {
    case STATISTICS.VITALITY:
      return { label: t('stat.vitality'), description: t('stats.description.vitality') }
    case STATISTICS.WISDOM:
      return { label: t('stat.wisdom'), description: t('stats.description.wisdom') }
    case STATISTICS.STRENGTH:
      return { label: t('stat.strength'), description: t('stats.description.strength') }
    case STATISTICS.INTELLIGENCE:
      return { label: t('stat.intelligence'), description: t('stats.description.intelligence') }
    case STATISTICS.CHANCE:
      return { label: t('stat.chance'), description: t('stats.description.chance') }
    case STATISTICS.AGILITY:
      return { label: t('stat.agility'), description: t('stats.description.agility') }
    case STATISTICS.CRITICAL:
      return { label: t('stat.critical_hit'), description: t('stats.description.critical_hit') }
    case STATISTICS.RAW_DAMAGE:
      return { label: t('stat.raw_damage'), description: t('stats.description.raw_damage') }
    default:
      return { label: '', description: '' }
  }
}

/**
 * The identity half of a characteristic row — the tinted icon gem (hover = the stat's name) followed by the
 * label/description stack. The trailing half (a value + steppers on the chain panel, an allocation input in
 * the simulator) is the caller's, because THAT is what genuinely differs between the two surfaces; the
 * identity never does.
 * @param {{ t: any, stat_key: string, describe?: boolean }} props
 */
export function StatIdentity({ t, stat_key, describe = true }) {
  const { label, description } = stat_text(t, stat_key)
  const tint = stat_identity(stat_key)?.tint ?? 'var(--fg-faint)'
  const icon = stat_identity(stat_key)?.icon
  return (
    <>
      <Tooltip text={label}>
        <span
          className="stats__prow-icon"
          data-stat-icon={stat_key}
          style={/** @type {import('react').CSSProperties} */ ({ '--tint': tint })}
        >
          {icon && <img src={icon} alt="" />}
        </span>
      </Tooltip>
      <span className="stats__prow-labels">
        <span className="stats__prow-label">{label}</span>
        {describe && <span className="stats__prow-desc">{description}</span>}
      </span>
    </>
  )
}
