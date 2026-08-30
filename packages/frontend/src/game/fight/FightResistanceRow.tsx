// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { FIGHT_ELEMENTS, type FighterResistances, type FightElement } from '@aresrpg/fight'
import type { StatName } from '@aresrpg/immutable'
import { Droplets, Flame, Mountain, Wind, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { stat_name, type AppCopy } from '../../i18n/copy.ts'
import { element_colors } from '../../visual_identity.ts'

const RESISTANCE_ICONS: Readonly<Record<FightElement, LucideIcon>> = Object.freeze({
  earth: Mountain,
  fire: Flame,
  water: Droplets,
  air: Wind,
})
const RESISTANCE_STATS: Readonly<Record<FightElement, StatName>> = Object.freeze({
  earth: 'earth_resistance',
  fire: 'fire_resistance',
  water: 'water_resistance',
  air: 'air_resistance',
})

const resistance_value = (value: bigint): string => `${value < 0n ? '−' : ''}${value < 0n ? -value : value}%`

export const FightResistanceRow = ({ copy, values }: Readonly<{ copy: AppCopy; values: FighterResistances }>) => (
  <span className="fight-resistances" data-fight-resistances>
    {FIGHT_ELEMENTS.map((element) => {
      const Icon = RESISTANCE_ICONS[element]
      const label = stat_name(copy, RESISTANCE_STATS[element])
      return (
        <span
          aria-label={`${label}: ${resistance_value(values[element])}`}
          className="fight-resistance"
          data-element={element}
          key={element}
          style={{ '--resist-color': element_colors[element] } as CSSProperties}
          title={label}
        >
          <Icon aria-hidden="true" size={11} strokeWidth={2} />
          <span>{resistance_value(values[element])}</span>
        </span>
      )
    })}
  </span>
)
