// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stable content identity for seed asset filenames and display names.

import { slugify } from './catalog.ts'

export const indexed_asset_key = (key: string): string => key.replaceAll('_', '')

export const spell_asset_key = (classe: string, name: string): string => {
  const asset_class = classe === 'yogan' ? 'yogen' : classe
  return indexed_asset_key(`${asset_class}_${slugify(name.replaceAll(/[’']/g, ''))}`)
}
