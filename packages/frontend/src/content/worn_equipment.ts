// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Both regular and cosmetic equipment resolve through the same anatomical model groups.

import { content_catalog } from './catalog.ts'
import { worn_equipment_category } from './character_model_catalog.ts'

export type WornEquipmentOption = Readonly<{
  item_type: string
  name: string
  category: 'hat' | 'cloak'
}>

const options = (category: WornEquipmentOption['category']): readonly WornEquipmentOption[] =>
  Object.freeze(
    content_catalog.items
      .filter((item) => worn_equipment_category(item.category) === category)
      .map(({ item_type, name }) => Object.freeze({ item_type, name, category }))
  )

export const worn_equipment_options = Object.freeze({ hats: options('hat'), cloaks: options('cloak') })
