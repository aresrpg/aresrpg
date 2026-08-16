// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_world_page, type Page } from '../modules/navigation.ts'

export const WORLD_FRAME_LAYER = 'z-0'

export const CANVAS_OVERLAY_CLASS = 'pointer-events-none absolute inset-0 p-4'

export const world_frame_visibility = (page: Page): string =>
  is_world_page(page) ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0'
