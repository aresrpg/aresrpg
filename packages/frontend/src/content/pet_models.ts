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
