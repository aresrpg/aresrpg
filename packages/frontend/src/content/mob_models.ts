// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mob identity owns its explicit material suffix: aragne__fire -> aragne.glb variant fire.

import { model_variant_identity, type ModelVariantIdentity } from '@aresrpg/immutable'

const model_modules: Readonly<Record<string, string>> =
  typeof Bun === 'undefined'
    ? (import.meta.glob('../../../../seed/models/mobs/*.glb', {
        eager: true,
        import: 'default',
        query: '?url',
      }) as Readonly<Record<string, string>>)
    : // Bun's test runtime has no Vite glob transform. Production takes the branch above after
      // Vite expands the direct call into the complete static model table.
      Object.freeze({})

const basename_of = (path: string): string =>
  path
    .split('/')
    .at(-1)
    ?.replace(/\.glb$/i, '') ?? ''
const urls_by_mob_type = Object.freeze(
  Object.fromEntries(Object.entries(model_modules).map(([path, url]) => [basename_of(path), url]))
)

export const mob_model_identity = (
  mob_type: string,
  available_basenames: readonly string[] = Object.keys(urls_by_mob_type)
): ModelVariantIdentity | null => model_variant_identity(mob_type, available_basenames)

export const mob_model_render = (mob_type: string): Readonly<{ model_url: string; variant: string | null }> | null => {
  const identity = mob_model_identity(mob_type)
  if (!identity) return null
  return Object.freeze({ model_url: urls_by_mob_type[identity.basename]!, variant: identity.variant })
}
