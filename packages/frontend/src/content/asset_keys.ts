// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stable content identity for seed asset filenames and display names.

import { slugify } from './catalog.ts'

export const indexed_asset_key = (key: string): string => key.replaceAll('_', '')

export const spell_asset_basename = (classe: string, name: string): string =>
  `${classe}_${slugify(name.replaceAll(/[’']/g, ''))}`

export const spell_asset_key = (classe: string, name: string): string =>
  indexed_asset_key(spell_asset_basename(classe, name))
