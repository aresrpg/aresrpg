// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { isValidSuiObjectId, normalizeSuiObjectId } from '@mysten/sui/utils'

import type { Pins } from './pins.ts'

const FREEZE_PREFIXES = ['math_', 'control_', 'combat_', 'seed_', 'kares_rewards_', ''] as const

/** Every active project lineage must lose upgrade authority together; the retired ABI has none. */
export const freeze_upgrade_targets = (pins: Pins): readonly Readonly<{ cap: string; package: string }>[] => {
  const targets = FREEZE_PREFIXES.map((prefix) => {
    const cap = pins[`${prefix}upgrade_cap`]
    const package_id = pins[`${prefix}package`]
    if (
      typeof cap !== 'string' ||
      !isValidSuiObjectId(cap) ||
      typeof package_id !== 'string' ||
      !isValidSuiObjectId(package_id)
    )
      throw new Error(`Permanent freeze requires the ${prefix || 'core_'}UpgradeCap and active package`)
    return { cap: normalizeSuiObjectId(cap), package: normalizeSuiObjectId(package_id) }
  })
  if (
    new Set(targets.map(({ cap }) => cap)).size !== targets.length ||
    new Set(targets.map(({ package: id }) => id)).size !== targets.length
  )
    throw new Error('Permanent freeze requires six distinct UpgradeCaps and package lineages')
  return targets
}
