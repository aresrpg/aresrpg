// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { game_pathname, page_from_pathname, type Page } from './modules/navigation.ts'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 1023px), (any-pointer: coarse)'

/** The pages the mobile surface has. Every other game page keeps its own responsive layout on a phone. */
const MOBILE_PAGES: readonly Page[] = ['world', 'settings']

/** `address` is the browser's address. */
export const uses_mobile_overlays = (address: string, compact: boolean): boolean =>
  compact && MOBILE_PAGES.includes(page_from_pathname(game_pathname(address)))
