// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacteristicValues } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import type { EquipmentMap } from './equipment_stage.ts'

/**
 * Optional local adapter. Absent adapters use the ordinary session projection and SDK effects.
 * An adapter states what it can do by the functions it holds, and the tabs offer exactly that: it
 * wears and takes off gear (`commit`), raises characteristics, and raises a spell only with `raise_spell`.
 * It crafts only with `craft`: one `run` is one request for that many tries of a recipe, and `locked`
 * is the sentence that says why none can be asked now. Without `craft` its bag is only read: a recipe
 * shows what the bag holds and draws no craft control. `roster` is the account's characters and the
 * way to look at another one; the jobs tab advises a better crafter only with it.
 * It holds no function to move items between accounts, or to use, feed, open, crush or destroy one,
 * so the equipment tab draws none of those for it. A new ability is a new optional function here.
 */
export type CharacterSession = Readonly<{
  equipment_notice?: string
  raise_spell?: (spell: string) => void
  craft?: Readonly<{ run: (output_type: string, attempts: number) => void; locked: string | null }>
  roster?: Readonly<{ characters: readonly CharacterRow[]; select: (character_id: string) => void }>
  inventory: readonly ItemRow[]
  commit: (equipment: EquipmentMap) => void
  raise_stats: (spending: CharacteristicValues) => void
}>
