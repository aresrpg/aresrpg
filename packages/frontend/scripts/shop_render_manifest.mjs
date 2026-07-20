// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
function same_render_identity(previous, item) {
  if (!previous) return false
  return (
    previous.appearance === item.appearance &&
    previous.category === item.category &&
    previous.render_key === item.render_key &&
    (previous.skin ?? null) === (item.skin ?? null) &&
    (previous.variant ?? null) === (item.variant ?? null)
  )
}

export function manifest_media_for_item({ item, previous, renderable, rendered_now, selected }) {
  const video = same_render_identity(previous, item) ? (previous.video ?? null) : null

  if (!selected || !renderable) {
    return {
      png: previous?.png ?? null,
      png_hd: previous?.png_hd ?? null,
      video,
    }
  }

  return {
    png: rendered_now ? `worn/${item.render_key}.png` : null,
    png_hd: rendered_now ? `worn/${item.render_key}_hd.png` : null,
    video,
  }
}
