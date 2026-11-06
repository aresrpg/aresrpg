// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { LandingAssets, LandingLinks } from './landing_types.ts'

/** Website-only artwork is served by the existing frontend public boundary. */
export const create_landing_assets = (
  icons: Pick<LandingAssets, 'portrait' | 'item_key' | 'item_horn' | 'item_bow'>
): LandingAssets => ({
  surface_desktop: '/landing/mosswood-surface-desktop.png',
  surface_phone: '/landing/mosswood-surface-phone.png',
  sign: '/landing/aresrpg-hanging-sign.png',
  world_capture: '/landing/engine-canvas-world-high.png',
  combat_capture: '/landing/engine-canvas-combat-high.png',
  ...icons,
})

export const landing_links = (origin: string, discord: string): LandingLinks => ({
  encyclopedia: new URL('/encyclopedia/items', origin).href,
  journal: 'https://journal.aresrpg.world',
  discord,
  telegram: 'https://t.me/aresrpg',
  x: 'https://x.com/AresRPG',
})
