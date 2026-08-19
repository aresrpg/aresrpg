// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One projection of every model-backed cosmetic that can be mounted on a character.

import { content_catalog } from './catalog.ts'

export type WornCosmeticOption = Readonly<{
  item_type: string
  name: string
  category: 'hat' | 'cloak'
}>

const item_options = (category: WornCosmeticOption['category']): readonly WornCosmeticOption[] =>
  content_catalog.items
    .filter((item) => item.category === category)
    .map(({ item_type, name }) => Object.freeze({ item_type, name, category }))

const airdrop_hats = content_catalog.airdrop.showcase
  .filter(({ kind, art_status }) => kind === 'cosmetic' && art_status.glb === 'present')
  .map(({ id, name }) => Object.freeze({ item_type: id, name, category: 'hat' as const }))

const unique = (rows: readonly WornCosmeticOption[]): readonly WornCosmeticOption[] =>
  Object.freeze(rows.filter((row, index) => rows.findIndex(({ item_type }) => item_type === row.item_type) === index))

export const worn_cosmetic_options = Object.freeze({
  hats: unique([...item_options('hat'), ...airdrop_hats]),
  cloaks: unique(item_options('cloak')),
})
