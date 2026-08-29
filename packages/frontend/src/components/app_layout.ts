// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_fight_board_page, type Page, world_scene_active } from '../modules/navigation.ts'

export const WORLD_FRAME_LAYER = 'z-0'

export const CANVAS_OVERLAY_CLASS = 'pointer-events-none absolute inset-0 p-4'

export const world_frame_visibility = (page: Page, fight_mounted = false): string =>
  world_scene_active(page, fight_mounted) ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'

export const fight_surface_visible = (page: Page, mounted: boolean): boolean => is_fight_board_page(page) && mounted

export const fight_lab_surface = (mounted: boolean): 'setup' | 'fight' => (mounted ? 'fight' : 'setup')

export const dungeon_lobby_visible = (page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  page === 'world' && !fight_active && dungeon_active

export const social_hud_visible = (page: Page, fight_active: boolean, dungeon_active: boolean): boolean =>
  page === 'world' && !dungeon_lobby_visible(page, fight_active, dungeon_active)
