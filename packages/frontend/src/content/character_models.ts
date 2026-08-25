// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seed model URLs and the exact legacy class/gender table. Render policy remains inside @aresrpg/engine.

import {
  character_model_basenames,
  worn_equipment_model_of as resolve_equipment_model,
} from './character_model_catalog.ts'

export { character_model_basenames } from './character_model_catalog.ts'

type WornItem = Readonly<{ item_type: string; category: string }>

const character_modules = import.meta.glob('../../../../seed/models/characters/*.glb', {
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, () => Promise<string>>>
const equipment_modules = import.meta.glob('../../../../seed/models/equipment/*.glb', {
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, () => Promise<string>>>

const basename_of = (path: string): string =>
  path
    .split('/')
    .at(-1)
    ?.replace(/\.glb$/i, '') ?? ''
const index_loaders = (
  modules: Readonly<Record<string, () => Promise<string>>>
): Readonly<Record<string, () => Promise<string>>> =>
  Object.freeze(Object.fromEntries(Object.entries(modules).map(([path, load]) => [basename_of(path), load])))

const character_loaders = index_loaders(character_modules)
const equipment_loaders = index_loaders(equipment_modules)
const equipment_basenames = new Set(Object.keys(equipment_loaders))

export const load_character_model_urls = async (
  classe: string,
  male: boolean
): Promise<Readonly<{ body_url: string | null; hair_url: string | null }>> => {
  const model = character_model_basenames(classe, male)
  const body = character_loaders[model.body]
  const hair = model.hair ? character_loaders[model.hair] : undefined
  const [body_url, hair_url] = await Promise.all([body?.() ?? null, hair?.() ?? null])
  return Object.freeze({ body_url, hair_url })
}

export const worn_equipment_model_of = (
  item: WornItem,
  available: ReadonlySet<string> = equipment_basenames
): Readonly<{ basename: string; variant: string | null }> | null => resolve_equipment_model(item, available)

export const load_worn_equipment_model_url = async (
  item: WornItem
): Promise<Readonly<{ url: string; variant: string | null }> | null> => {
  const model = worn_equipment_model_of(item)
  const load = model ? equipment_loaders[model.basename] : undefined
  if (!model || !load) return null
  return Object.freeze({ url: await load(), variant: model.variant })
}
