// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const dragon_files = Object.freeze({
  fire: 'dragon-fire.glb',
  frost: 'dragon-frost.glb',
  void: 'dragon-void.glb',
})

export const fast_travel_asset_refs = Object.freeze(
  Object.values(dragon_files).map((filename) => Object.freeze({ url_class: 'mob', filename }))
)

/** @param {string | null | undefined} variant */
export function fast_travel_dragon_file(variant) {
  return dragon_files[variant ?? 'fire'] ?? dragon_files.fire
}
