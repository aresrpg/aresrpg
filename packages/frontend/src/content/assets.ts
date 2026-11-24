// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One icon address per seed icon, derived from its identity: a page loads exactly the icons it shows. The
// display-asset plugin (`display_assets.ts`) serves seed/icons at these paths in development and emits the same
// files there at build.

import { portrait_url, type PortraitColors } from '@aresrpg/immutable/portrait'

import { spell_asset_basename } from './asset_keys.ts'
import { character_model_basenames } from './character_model_catalog.ts'

const icon = (family: string, name: string, extension: string): string =>
  `/icons/${family}/${encodeURIComponent(name)}${extension}`

export const item_icon = (item_type: string): string | null => (item_type ? icon('items', item_type, '.png') : null)

export const mob_icon = (mob_type: string): string | null => (mob_type ? icon('mobs', mob_type, '.png') : null)

export const spell_icon = (classe: string, name: string): string | null =>
  classe ? icon('spells', spell_asset_basename(classe, name), '.webp') : null

/** A character's portrait in its colours, or its class art when no colours are given. */
export const character_icon = (classe: string, sex: string, colors?: PortraitColors): string | null =>
  (colors ? portrait_url({ classe, sex, ...colors }) : null) ??
  icon('characters', character_model_basenames(classe, sex === 'male').body, '.png')

export const nameplate_artwork_url = (basename: string | undefined): string | undefined =>
  basename ? icon('nameplates', basename, '.png') : undefined
