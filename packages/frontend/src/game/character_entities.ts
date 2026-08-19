// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One character appearance projection for world, fights, and previews. The engine owns pixels;
// this boundary resolves seed assets and turns chain rows into its plain render contract.

import type {
  CharacterAnimationName,
  CharacterAppearanceRender,
  CharacterEntityRender,
  Vec3,
  WornModelRender,
} from '@aresrpg/engine'
import type { CharacterRow, EquippedItem, PresenceRow } from '@aresrpg/protocol'

type CharacterRenderRow = Readonly<
  Omit<CharacterRow, 'equipment'> & {
    equipment: readonly Readonly<EquippedItem>[]
  }
>

export type CharacterRenderSource = Readonly<{
  id: string
  classe: string
  male: boolean
  colors: readonly [string, string, string]
  loadout: Readonly<Record<string, string>>
}>

export type LoadedCharacterRender = Readonly<{
  id: string
  appearance: CharacterAppearanceRender
}>

const color_hex = (value: number): string => `#${value.toString(16).padStart(6, '0').slice(-6)}`

export const character_render_source = (character: CharacterRenderRow): CharacterRenderSource =>
  Object.freeze({
    id: character.id,
    classe: character.classe,
    male: character.sex === 'male',
    colors: Object.freeze([
      color_hex(character.color_1),
      color_hex(character.color_2),
      color_hex(character.color_3),
    ] as const),
    loadout: Object.freeze(Object.fromEntries(character.equipment.map(({ slot, item_type }) => [slot, item_type]))),
  })

/** A nearby player's display payload projected into the same render source as own characters. */
export const presence_render_source = (row: Readonly<PresenceRow>): CharacterRenderSource =>
  Object.freeze({
    id: row.character_id,
    classe: row.classe,
    male: row.sex === 'male',
    colors: Object.freeze([color_hex(row.color_1), color_hex(row.color_2), color_hex(row.color_3)] as const),
    loadout: Object.freeze({
      ...(row.hat ? { hat: row.hat } : {}),
      ...(row.cloak ? { cloak: row.cloak } : {}),
    }),
  })

export const load_character_appearance = async (
  source: Readonly<CharacterRenderSource>
): Promise<CharacterAppearanceRender> => {
  const [{ load_character_model_urls, load_cosmetic_model_url }, { worn_cosmetic_options }] = await Promise.all([
    import('../content/character_models.ts'),
    import('../content/worn_cosmetics.ts'),
  ])
  const worn_model = async (
    item_type: string | undefined,
    category: 'hat' | 'cloak'
  ): Promise<WornModelRender | null> => {
    if (!item_type) return null
    const options = category === 'hat' ? worn_cosmetic_options.hats : worn_cosmetic_options.cloaks
    const item = options.find((candidate) => candidate.item_type === item_type)
    return item ? load_cosmetic_model_url(item) : null
  }
  const [{ body_url, hair_url }, head, back] = await Promise.all([
    load_character_model_urls(source.classe, source.male),
    worn_model(source.loadout.hat, 'hat'),
    worn_model(source.loadout.cloak, 'cloak'),
  ])
  return Object.freeze({
    body_url,
    hair_url,
    colors: source.colors,
    worn: Object.freeze({ head, back }),
  })
}

export const world_character_entity = (
  character: Readonly<LoadedCharacterRender>,
  transform: Readonly<{
    position: Vec3
    facing_yaw: number
    anim: CharacterAnimationName
    gait_scale: number
    visible?: boolean
  }>
): CharacterEntityRender =>
  Object.freeze({
    id: character.id,
    kind: 'character',
    appearance: character.appearance,
    anchor: Object.freeze({ kind: 'world', position: transform.position }),
    facing: Object.freeze({ kind: 'yaw', yaw: transform.facing_yaw }),
    animation: Object.freeze({ name: transform.anim, time_scale: transform.gait_scale }),
    visible: transform.visible,
  })
