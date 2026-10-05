// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type Copy = Readonly<{
  title: string
  sale: string
  price_before_fees: string
  gather_title: string
  gather: string
  victory_title: string
  victory: string
  loot_title: string
  loot: string
  sold_by: string
  found_by: string
  boss_defeated: string
  level: string
  stats: Readonly<Record<string, string>>
}>
export const load_copy = async (locale: string): Promise<Copy> => {
  if (!/^[a-z]{2}$/.test(locale)) throw new Error('Invalid Discord locale')
  const file = new URL(`../../frontend/src/i18n/locales/${locale}.yaml`, import.meta.url)
  const document = Bun.YAML.parse(await Bun.file(file).text()) as {
    discord_marketplace?: Omit<Copy, 'stats'>
    simulator_page: Record<string, string>
  }
  const copy = document.discord_marketplace
  const keys = [
    'title',
    'sale',
    'price_before_fees',
    'gather_title',
    'gather',
    'victory_title',
    'victory',
    'loot_title',
    'loot',
    'sold_by',
    'found_by',
    'boss_defeated',
    'level',
  ] as const
  if (!copy || !keys.every((key) => typeof copy[key] === 'string'))
    throw new Error('Discord locale is missing notification copy')
  const stats = Object.fromEntries(
    Object.entries(document.simulator_page)
      .filter(([key]) => key.startsWith('stat_'))
      .map(([key, value]) => [key.slice(5), value])
  )
  return { ...copy, stats }
}
export const interpolate = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
