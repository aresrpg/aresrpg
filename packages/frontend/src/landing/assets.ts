// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import portrait from '../../../../seed/icons/characters/senshi_male_hd.png'
import item_key from '../../../../seed/icons/items/key_of_ivory_rampart_hd.png'
import item_horn from '../../../../seed/icons/items/tidal_horn_core_hd.png'
import item_bow from '../../../../seed/icons/items/amberwood_recurve_hd.png'

import type { LandingAssets } from './landing_types.ts'

/** Website-only artwork is served by the existing frontend public boundary. */
export const landing_assets: LandingAssets = {
  surface_desktop: '/landing/mosswood-surface-desktop.png',
  surface_phone: '/landing/mosswood-surface-phone.png',
  sign: '/landing/aresrpg-hanging-sign.png',
  world_capture: '/landing/engine-canvas-world-high.png',
  combat_capture: '/landing/engine-canvas-combat-high.png',
  portrait,
  item_key,
  item_horn,
  item_bow,
}
