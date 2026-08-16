// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const SURFACE_VARIATION = Object.freeze({
  micro_scale: 4,
})

export const surface_phase = (seed: number): number => ((seed >>> 0) / 0x1_0000_0000) * Math.PI * 2
