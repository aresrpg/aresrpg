// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const MOBILE_VIEWPORT_QUERY = '(max-width: 1023px), (any-pointer: coarse)'

/** Shared routes (demo, gifts and finance) retain their existing responsive presentations. */
export const uses_mobile_overlays = (pathname: string, compact: boolean): boolean =>
  compact &&
  ['', 'world', 'characters', 'marketplace', 'settings', 'encyclopedia'].includes(pathname.split('/')[1] ?? '')
