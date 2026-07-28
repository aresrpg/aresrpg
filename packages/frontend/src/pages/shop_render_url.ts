// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type AssetResolver = (url_class: string, filename: string) => string | null

/** Shop-render manifests identify assets by basename, even when the source file is nested. */
export function shop_render_identifier(relative_path: string | null | undefined): string | null {
  if (!relative_path) return null
  return relative_path.split('/').at(-1) || null
}

/** Resolve one shop still/video through the manifest-backed shop_render class. */
export function resolve_shop_render_url(
  relative_path: string | null | undefined,
  resolve_asset: AssetResolver
): string | null {
  const identifier = shop_render_identifier(relative_path)
  return identifier ? resolve_asset('shop_render', identifier) : null
}
