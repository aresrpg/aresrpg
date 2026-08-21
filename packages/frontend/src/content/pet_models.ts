// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pet identity is its item identity: one same-named GLB, no catalog or fallback lookup.

const modules = import.meta.glob('../../../../seed/models/pets/*.glb', {
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, () => Promise<string>>>

const loaders = Object.freeze(
  Object.fromEntries(
    Object.entries(modules).map(([path, load]) => [
      path
        .split('/')
        .at(-1)!
        .replace(/\.glb$/i, ''),
      load,
    ])
  )
) as Readonly<Record<string, () => Promise<string>>>

export const pet_model_types = Object.freeze(Object.keys(loaders))

export const load_pet_model_url = async (item_type: string): Promise<string | null> => loaders[item_type]?.() ?? null

/** The ONE pet-companion loader — demo lab and player app resolve the SAME shape from the
 *  SAME facts (model registry + catalog locomotion); a missing model or item loads nothing. */
export const load_pet_companion = async (
  id: string,
  item_type: string
): Promise<Readonly<{
  id: string
  model_url: string
  locomotion: import('../game/core/pet_locomotion.ts').PetLocomotion
}> | null> => {
  const [{ content_catalog }, { pet_locomotion_of }] = await Promise.all([
    import('./catalog.ts'),
    import('../game/core/pet_locomotion.ts'),
  ])
  const model_url = await load_pet_model_url(item_type)
  const item = content_catalog.item(item_type)?.item
  return model_url && item ? Object.freeze({ id, model_url, locomotion: pet_locomotion_of(item) }) : null
}
