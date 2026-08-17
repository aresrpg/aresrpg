// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { equipment_slot_accepts, type CharacterEquipmentSlot } from '@aresrpg/immutable'

import { encyclopedia_catalog } from '../content/catalog.ts'

export const simulator_loadout_items = (slot: CharacterEquipmentSlot) =>
  Object.freeze(
    encyclopedia_catalog.items
      .filter(({ category }) => equipment_slot_accepts(slot, category))
      .toSorted((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  )
