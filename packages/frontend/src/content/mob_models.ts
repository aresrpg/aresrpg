// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One mob_type, one seed model. Three.js loading and render policy remain inside @aresrpg/engine.

const model_modules = import.meta.glob('../../../../seed/models/mobs/*.glb', {
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, () => Promise<string>>>

const basename_of = (path: string): string =>
  path
    .split('/')
    .at(-1)
    ?.replace(/\.glb$/i, '') ?? ''
const loaders_by_mob_type = Object.freeze(
  Object.fromEntries(Object.entries(model_modules).map(([path, load]) => [basename_of(path), load]))
)

export const load_mob_model_url = async (mob_type: string): Promise<string | null> => {
  const load = loaders_by_mob_type[mob_type]
  return load ? load() : null
}
