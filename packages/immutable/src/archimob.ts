// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

type MobIdentity = Readonly<{ mob_type: string; family: string; role: string }>
export type ArchimobRow = Readonly<{ ordinary_type: string; archi_type: string }>

export const archimob_rows = (
  mobs: readonly MobIdentity[],
  ordinary_types: readonly string[]
): readonly ArchimobRow[] => {
  const mobs_by_type = new Map(mobs.map((mob) => [mob.mob_type, mob] as const))
  const archi_by_family = new Map(
    mobs.filter(({ role }) => role === 'archi').map(({ family, mob_type }) => [family, mob_type] as const)
  )
  return Object.freeze(
    [...new Set(ordinary_types)].flatMap((ordinary_type) => {
      const ordinary = mobs_by_type.get(ordinary_type)
      const archi_type = ordinary?.role === 'normal' ? archi_by_family.get(ordinary.family) : undefined
      return archi_type ? [Object.freeze({ ordinary_type, archi_type })] : []
    })
  )
}
