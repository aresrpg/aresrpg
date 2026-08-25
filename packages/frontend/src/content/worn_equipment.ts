// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Hat and cloak models are real equipment: one item identity, one same-named GLB.

import { content_catalog } from './catalog.ts'

export type WornEquipmentOption = Readonly<{
  item_type: string
  name: string
  category: 'hat' | 'cloak'
}>

const options = (category: WornEquipmentOption['category']): readonly WornEquipmentOption[] =>
  Object.freeze(
    content_catalog.items
      .filter((item) => item.category === category)
      .map(({ item_type, name }) => Object.freeze({ item_type, name, category }))
  )

export const worn_equipment_options = Object.freeze({ hats: options('hat'), cloaks: options('cloak') })
