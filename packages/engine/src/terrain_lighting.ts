// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const FACE_BRIGHTNESS = Object.freeze([0.6, 0.6, 1, 0.5, 0.8, 0.8] as const)
export const AO_LEVELS = Object.freeze([0.35, 0.82, 0.92, 1] as const)
export const AO_FLOOR = Object.freeze({ top: 0.45, side: 0.58 })

export const face_brightness = (face: number): number => FACE_BRIGHTNESS[Math.max(0, Math.min(5, face))]!
export const ao_brightness = (level: number, top: boolean): number => {
  const fraction = AO_LEVELS[Math.max(0, Math.min(3, level))]!
  const floor = top ? AO_FLOOR.top : AO_FLOOR.side
  return floor + (1 - floor) * fraction
}
