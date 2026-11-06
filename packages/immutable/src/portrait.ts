// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import manifest from '../../../seed/portraits/manifest.json' with { type: 'json' }

export type PortraitColors = Readonly<{ color_1: number; color_2: number; color_3: number }>
export type PortraitAppearance = PortraitColors & Readonly<{ classe: string; sex: string }>
export const PORTRAIT_PATH = '/api/portrait'
export const PORTRAIT_REVISION = manifest.version
const color_keys = ['color_1', 'color_2', 'color_3'] as const
export const portrait_name = ({ classe, sex }: Readonly<{ classe: string; sex: string }>): string | null => {
  const name = `${classe.toLowerCase()}_${sex}`
  return Object.hasOwn(manifest.portraits, name) ? name : null
}
export const valid_portrait_colors = (colors: PortraitColors): boolean =>
  color_keys.every((key) => Number.isInteger(colors[key]) && colors[key] >= 0 && colors[key] <= 0xffffff)

export const portrait_url = (appearance: PortraitAppearance): string | null => {
  if (!portrait_name(appearance) || !valid_portrait_colors(appearance)) return null
  const query = new URLSearchParams({
    revision: PORTRAIT_REVISION,
    classe: appearance.classe.toLowerCase(),
    sex: appearance.sex,
  })
  color_keys.forEach((key) => query.set(key, String(appearance[key])))
  return `${PORTRAIT_PATH}?${query}`
}

// Display V2 resolves these fields from the Character object. Deployment and registry updates
// are separate administrator operations; constructing this template submits no transaction.
export const character_display_image = (origin: string): string =>
  `${origin}${PORTRAIT_PATH}?revision=${PORTRAIT_REVISION}&classe={classe}&sex={sex}&color_1={color_1}&color_2={color_2}&color_3={color_3}`

export const parse_portrait_query = (query: URLSearchParams): PortraitAppearance | null => {
  if (query.get('revision') !== PORTRAIT_REVISION) return null
  if (!color_keys.every((key) => /^\d{1,8}$/.test(query.get(key) ?? ''))) return null
  const appearance = {
    classe: query.get('classe') ?? '',
    sex: query.get('sex') ?? '',
    color_1: Number(query.get('color_1')),
    color_2: Number(query.get('color_2')),
    color_3: Number(query.get('color_3')),
  }
  return portrait_name(appearance) && valid_portrait_colors(appearance) ? appearance : null
}
