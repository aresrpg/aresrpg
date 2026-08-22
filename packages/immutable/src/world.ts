// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Layout twin of world.move. Chain coordinates are unsigned; client origin is the center. */
export const world_size = 100_000
export const world_center = world_size / 2

/** Chain positions are unsigned. Rendering stays close to zero so GPU transforms retain precision. */
export const chain_to_client_coordinate = (coordinate: number): number => coordinate - world_center

/** Inverse of chain_to_client_coordinate for live presence and on-chain movement inputs. */
export const client_to_chain_coordinate = (coordinate: number): number => coordinate + world_center

export type WorldGate = Readonly<{ name: string; entry_level: number }>

/** Layout twin of world_map.move's names + entry levels, in the chain's own order — the gate
 *  re-asserts every level; this copy only greys the picker rows the character cannot enter. */
export const WORLD_GATES: readonly WorldGate[] = Object.freeze([
  Object.freeze({ name: '01_first_shore', entry_level: 1 }),
  Object.freeze({ name: '02_verdant_hollow', entry_level: 1 }),
  Object.freeze({ name: '03_emberfall_steppe', entry_level: 10 }),
  Object.freeze({ name: '04_mistral_heights', entry_level: 14 }),
  Object.freeze({ name: '05_drowned_fen', entry_level: 18 }),
  Object.freeze({ name: '06_pandora_reach', entry_level: 22 }),
  Object.freeze({ name: '07_cinderforge_depths', entry_level: 30 }),
  Object.freeze({ name: '08_palewood', entry_level: 34 }),
  Object.freeze({ name: '09_coral_throne', entry_level: 40 }),
  Object.freeze({ name: '10_sunspire_dunes', entry_level: 45 }),
  Object.freeze({ name: '11_rootheart', entry_level: 52 }),
  Object.freeze({ name: '12_static_fields', entry_level: 60 }),
  Object.freeze({ name: '13_mirrormere', entry_level: 68 }),
  Object.freeze({ name: '14_charnel_marches', entry_level: 75 }),
  Object.freeze({ name: '15_silent_atoll', entry_level: 82 }),
  Object.freeze({ name: '16_the_sundering', entry_level: 95 }),
  Object.freeze({ name: '17_obsidian_choir', entry_level: 110 }),
  Object.freeze({ name: '18_abyssal_weald', entry_level: 125 }),
  Object.freeze({ name: '19_hollow_crown', entry_level: 145 }),
  Object.freeze({ name: '20_zenith_scar', entry_level: 170 }),
])

export const world_entry_level = (name: string): number =>
  WORLD_GATES.find((gate) => gate.name === name)?.entry_level ?? Number.MAX_SAFE_INTEGER
