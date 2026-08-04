// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE home for "which GLB is which dragon". Every dragon surface reads it — the ridden fast-travel mount
// and the ambient sky dragon — because the same fact written twice is how #2199 happened: one copy kept the
// published name while the other drifted to an internal codename that storage never served, and every fresh
// cache 404'd. The names here are the PUBLIC ones the asset bucket holds; a codename never ships in a URL.

const dragon_files = Object.freeze({
  fire: 'dragon-fire.glb',
  frost: 'dragon-frost.glb',
  void: 'dragon-void.glb',
})

export const fast_travel_asset_refs = Object.freeze(
  Object.values(dragon_files).map((filename) => Object.freeze({ url_class: 'mob', filename }))
)

/** The published GLB for a dragon skin key, or null when the key names no skin (each surface picks its own
 *  default — the ridden mount rides fire, the ambient sky dragon soars void). @param {string|null|undefined} key */
export function dragon_glb_file(key) {
  return dragon_files[String(key ?? '').toLowerCase()] ?? null
}

/** @param {string | null | undefined} variant */
export function fast_travel_dragon_file(variant) {
  return dragon_glb_file(variant) ?? dragon_files.fire
}
