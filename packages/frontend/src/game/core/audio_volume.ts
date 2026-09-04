// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The persisted setting is authoritative; this tiny effect projection serves audio calls that
// intentionally live outside React and therefore cannot select the Zustand store.

export const DEFAULT_MASTER_VOLUME = 1

export const master_volume_from = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_MASTER_VOLUME

// eslint-disable-next-line functional/no-let -- non-React audio effects read this projection of the reducer-owned setting.
let current_master_volume = DEFAULT_MASTER_VOLUME

export const set_master_audio_volume = (volume: number): void => {
  current_master_volume = master_volume_from(volume)
}

export const scale_audio_volume = (volume: number, master = current_master_volume): number =>
  master_volume_from(master) * Math.min(1, Math.max(0, volume))
