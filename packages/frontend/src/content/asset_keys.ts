// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stable content identity for seed asset filenames and display names.

import { slugify } from './titles.ts'

/** A spell's icon file name: its class, then its name as a slug without apostrophes. */
export const spell_asset_basename = (classe: string, name: string): string =>
  `${classe}_${slugify(name.replaceAll(/[’']/g, ''))}`
