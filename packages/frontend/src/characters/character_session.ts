// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacteristicValues } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import type { EquipmentMap } from './equipment_stage.ts'

/** Optional local adapter. Absent adapters use the ordinary session projection and SDK effects. */
export type CharacterSession = Readonly<{
  raise_spell?: (spell: string) => void
  inventory: readonly ItemRow[]
  commit: (equipment: EquipmentMap) => void
  raise_stats: (spending: CharacteristicValues) => void
}>
