// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const SURFACE_VARIATION = Object.freeze({
  micro_scale: 4,
})

// Trigonometric hashes lose cell precision once large world coordinates reach the GPU's f32
// mantissa. Keep their inputs local; the period is far wider than the visible direct-terrain area.
export const SURFACE_HASH_WRAP = 4096

export const surface_phase = (seed: number): number => ((seed >>> 0) / 0x1_0000_0000) * Math.PI * 2
