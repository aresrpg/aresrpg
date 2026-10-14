// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { class_names, is_class_name, model_variant_identity } from '@aresrpg/immutable'

export type CharacterModelBasenames = Readonly<{ body: string; hair?: string }>
type WornItem = Readonly<{ item_type: string; category: string }>

export const authored_character_model_classes = class_names

/** Bodies no class owns. They obey the same body/hair contract and share the character model home. */
export const NPC_CHARACTER_MODELS: Readonly<Record<string, CharacterModelBasenames>> = Object.freeze({
  blast_girl: Object.freeze({ body: 'blast_girl' }),
})

export const character_model_basenames = (classe: string, male: boolean): CharacterModelBasenames => {
  const normalized = classe.toLowerCase()
  const npc = NPC_CHARACTER_MODELS[normalized]
  if (npc) return npc
  const body = `${is_class_name(normalized) ? normalized : 'senshi'}_${male ? 'male' : 'female'}`
  return Object.freeze({ body, hair: `${body}_hair` })
}

export const worn_equipment_category = (category: string): 'hat' | 'cloak' | null => {
  if (category === 'hat' || category === 'cosmetic_hat') return 'hat'
  if (category === 'cloak' || category === 'cosmetic_cloak') return 'cloak'
  return null
}

export const worn_equipment_model_of = (
  item: WornItem,
  available: ReadonlySet<string>
): Readonly<{ basename: string; variant: string | null }> | null => {
  if (!worn_equipment_category(item.category)) return null
  return model_variant_identity(item.item_type, [...available])
}
