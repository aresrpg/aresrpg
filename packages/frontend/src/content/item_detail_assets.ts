// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HD item art stays behind the lazy encyclopedia route; lists and other features keep the thumbnail index.

import { item_icon } from './assets.ts'

const item_detail_modules = import.meta.glob('../../../../seed/icons/items/*_hd.{png,webp,jpg,jpeg}', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Readonly<Record<string, string>>

const item_detail_assets = Object.freeze(
  Object.fromEntries(
    Object.entries(item_detail_modules).map(([path, url]) => [
      path
        .split('/')
        .at(-1)!
        .replace(/_hd\.(png|webp|jpe?g)$/i, ''),
      url,
    ])
  )
) as Readonly<Record<string, string>>

export const item_detail_icon = (item_type: string): string | null =>
  item_detail_assets[item_type] ?? item_icon(item_type)
