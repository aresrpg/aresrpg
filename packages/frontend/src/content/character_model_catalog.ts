// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { model_variant_identity } from '@aresrpg/immutable'

export type CharacterModelBasenames = Readonly<{ body: string; hair?: string }>
type WornItem = Readonly<{ item_type: string; category: string }>

const SENSHI_MODELS = Object.freeze({
  male: Object.freeze({ body: 'senshi_male', hair: 'senshi_male_hair' }),
  female: Object.freeze({ body: 'senshi_female', hair: 'senshi_female_hair' }),
})

const CHARACTER_MODELS: Readonly<
  Record<string, Readonly<{ male: CharacterModelBasenames; female: CharacterModelBasenames }>>
> = Object.freeze({
  senshi: SENSHI_MODELS,
  shugo: Object.freeze({
    male: Object.freeze({ body: 'shugo_male', hair: 'shugo_male_hair' }),
    female: Object.freeze({ body: 'shugo_female', hair: 'shugo_female_hair' }),
  }),
  tomoda: Object.freeze({
    male: Object.freeze({ body: 'tomoda_male', hair: 'tomoda_male_hair' }),
    female: Object.freeze({ body: 'tomoda_female', hair: 'tomoda_female_hair' }),
  }),
  yajin: Object.freeze({
    male: Object.freeze({ body: 'yajin_male', hair: 'yajin_male_hair' }),
    female: Object.freeze({ body: 'yajin_female', hair: 'yajin_female_hair' }),
  }),
  rojin: Object.freeze({
    male: Object.freeze({ body: 'rojin_male', hair: 'rojin_male_hair' }),
    female: Object.freeze({ body: 'rojin_female', hair: 'rojin_female_hair' }),
  }),
  tokei: Object.freeze({
    male: Object.freeze({ body: 'tokei_male', hair: 'tokei_male_hair' }),
    female: Object.freeze({ body: 'tokei_female', hair: 'tokei_female_hair' }),
  }),
})

export const authored_character_model_classes = Object.freeze(Object.keys(CHARACTER_MODELS))

export const character_model_basenames = (classe: string, male: boolean): CharacterModelBasenames =>
  CHARACTER_MODELS[classe.toLowerCase()]?.[male ? 'male' : 'female'] ?? SENSHI_MODELS[male ? 'male' : 'female']

export const worn_equipment_model_of = (
  item: WornItem,
  available: ReadonlySet<string>
): Readonly<{ basename: string; variant: string | null }> | null => {
  if (item.category !== 'hat' && item.category !== 'cloak') return null
  return model_variant_identity(item.item_type, [...available])
}
