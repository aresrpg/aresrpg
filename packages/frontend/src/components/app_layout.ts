// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { type Page } from '../modules/navigation.ts'

export const WORLD_FRAME_LAYER = 'z-0'

export const CANVAS_OVERLAY_CLASS = 'pointer-events-none absolute inset-0 p-4'

export const fight_lab_surface = (mounted: boolean): 'setup' | 'fight' => (mounted ? 'fight' : 'setup')

export const dungeon_lobby_visible = (page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  page === 'world' && !fight_active && dungeon_active

export const social_hud_visible = (page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  page === 'world' && !dungeon_lobby_visible(page, fight_active, dungeon_active)

export const graphics_notice_visible = (
  outside_world: boolean,
  failed: boolean,
  world_unavailable: boolean,
  dismissed: boolean,
  degraded: boolean
): boolean => !outside_world && ((failed && !world_unavailable) || (!dismissed && (world_unavailable || degraded)))
