// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One mob_type, one seed model. Three.js loading and render policy remain inside @aresrpg/engine.

const model_modules = import.meta.glob('../../../../seed/models/mobs/*.glb', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, string>>

const basename_of = (path: string): string =>
  path
    .split('/')
    .at(-1)
    ?.replace(/\.glb$/i, '') ?? ''
const urls_by_mob_type = Object.freeze(
  Object.fromEntries(Object.entries(model_modules).map(([path, url]) => [basename_of(path), url]))
)

export const mob_model_url = (mob_type: string): string | null => urls_by_mob_type[mob_type] ?? null
