// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One icon index shared by every frontend feature.

import { slugify } from './catalog.ts'

const item_modules = import.meta.glob(
  ['../../../../seed/icons/items/*.{png,webp,jpg,jpeg}', '!../../../../seed/icons/items/*_hd.{png,webp,jpg,jpeg}'],
  { eager: true, import: 'default', query: '?url' }
) as Readonly<Record<string, string>>

const mob_modules = import.meta.glob(
  ['../../../../seed/icons/mobs/*.{png,webp,jpg,jpeg}', '!../../../../seed/icons/mobs/*_hd.{png,webp,jpg,jpeg}'],
  { eager: true, import: 'default', query: '?url' }
) as Readonly<Record<string, string>>

const spell_modules = import.meta.glob('../../../../seed/icons/spells/*.{png,webp,jpg,jpeg}', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, string>>

const asset_key = (path: string): string =>
  path
    .split('/')
    .at(-1)!
    .replace(/\.(png|webp|jpe?g)$/i, '')

const index_assets = (modules: Readonly<Record<string, string>>): Readonly<Record<string, string>> => {
  const entries = Object.entries(modules).map(([path, url]) => [asset_key(path), url] as const)
  return Object.freeze(Object.fromEntries(entries))
}

const item_assets = index_assets(item_modules)
const mob_assets = index_assets(mob_modules)
const spell_assets = index_assets(spell_modules)

export const item_icon = (item_type: string): string | null => item_assets[item_type] ?? null
export const mob_icon = (mob_type: string): string | null => mob_assets[mob_type] ?? null
export const spell_icon = (classe: string, name: string): string | null => {
  const asset_class = classe === 'yogan' ? 'yogen' : classe
  const compact_name = slugify(name.replaceAll(/[’']/g, ''))
  return spell_assets[`${asset_class}_${compact_name}`] ?? spell_assets[`${asset_class}_${slugify(name)}`] ?? null
}
