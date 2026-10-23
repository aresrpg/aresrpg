// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Assets the runtime fetches must stay real files: production connect-src deliberately excludes data
 * URLs, so an inlined one fails as `TypeError: Failed to fetch`. GLTFLoader fetches models and the
 * city loaders fetch their generated JSON artifacts (a small `*_details.json` fell under Vite's 4 KiB
 * default and broke every chunk around The Ruins and Fuwage). `undefined` keeps Vite's default.
 */
export const asset_inline_limit = (path: string): false | undefined =>
  path.endsWith('.glb') || path.endsWith('.json') ? false : undefined
