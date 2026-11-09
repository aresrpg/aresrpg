// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ZoneRow } from './packets.ts'

export const zone_key = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`
export type WorldWindow = Readonly<{ world: string; zones: readonly Readonly<{ zx: number; zz: number }>[] }>
export const tracked_zone_keys = (windows: readonly WorldWindow[]): ReadonlySet<string> =>
  new Set(windows.flatMap(({ world, zones }) => zones.map(({ zx, zz }) => zone_key(world, zx, zz))))

export const retain_zone_keys = <T>(
  rows: Readonly<Record<string, T>>,
  keys: ReadonlySet<string>
): Readonly<Record<string, T>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([key]) => keys.has(key))))

/** Zone rows merge; only a changed seed invalidates the server-derived population. */
export const merge_zone_rows = <T>(
  previous: Readonly<Record<string, ZoneRow>>,
  populations: Readonly<Record<string, T>>,
  incoming: readonly ZoneRow[]
) => {
  const zones = { ...previous }
  const rerolled = new Set<string>()
  incoming.forEach((zone) => {
    const key = zone_key(zone.world, zone.zx, zone.zz)
    if (zones[key] && zones[key]!.seed !== zone.seed) rerolled.add(key)
    zones[key] = zone
  })
  const spawns = rerolled.size
    ? Object.freeze(Object.fromEntries(Object.entries(populations).filter(([key]) => !rerolled.has(key))))
    : populations
  return Object.freeze({ zones: Object.freeze(zones), spawns })
}

/** Population packets have no seed identity. The server's zone baseline must arrive first. */
export const merge_zone_population = <T>(
  zones: Readonly<Record<string, ZoneRow>>,
  spawns: Readonly<Record<string, T>>,
  key: string,
  population: T
): Readonly<Record<string, T>> => (zones[key] ? Object.freeze({ ...spawns, [key]: population }) : spawns)
