// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
const slot_framing = Object.freeze({
  // Sane-distance front view (reframe law: move the camera away — never the old close-up
  // zoom). The per-hat bbox autofit (shop_head_autofit) overrides dolly + aim for every measurable hat;
  // this default only frames a hat whose probe render came back blank.
  head: Object.freeze({
    camera_radius: 3.6,
    camera_y: 1.15,
    face_radians: 0,
    orbit_degrees: 42,
    seek_seconds: 2.25,
    target_y: 1.15,
  }),
  // Showcase defaults plus the existing face flip: preserve the cloak's full-body back-quarter view.
  back: Object.freeze({
    camera_radius: 3.6,
    camera_y: 1.65,
    face_radians: Math.PI,
    orbit_degrees: 42,
    seek_seconds: 2.25,
    target_y: 1.3,
  }),
})

export function worn_slot_for_category(category) {
  if (category === 'hat') return 'head'
  if (category === 'cloak') return 'back'
  throw new Error(`unsupported worn cosmetic category: ${category}`)
}

export function framing_for_slot(slot) {
  const framing = slot_framing[slot]
  if (!framing) throw new Error(`unsupported worn cosmetic slot: ${slot}`)
  return framing
}

export function framing_search_params(slot) {
  const framing = framing_for_slot(slot)
  return new URLSearchParams({
    camr: String(framing.camera_radius),
    camy: String(framing.camera_y),
    face: String(framing.face_radians),
    orbit: String(framing.orbit_degrees),
    ty: String(framing.target_y),
  })
}
