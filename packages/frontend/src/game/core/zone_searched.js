// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ZoneSearched event decode (SEARCH-ZONE JUICE) — the pure contract-coupling seam between the search tx
// receipt and the reveal banner's findings counts. Split out of the effect-heavy discovery_actions seam so
// it's a pure transform over plain data (unit-testable without the auth/SDK import graph). Pins the on-chain
// event identity: `zones.move` emits `ZoneSearched { world, zx, zy, at_ms, mob_groups, resource_nodes }`; a
// rename there must break THIS test, not silently zero the banner.

/**
 * Read the `ZoneSearched` event off a run_tx normalized receipt
 * → `{ zx, zy, at_ms, mob_groups, resource_nodes }`.
 * u64 fields arrive as strings — coerced to numbers. Absent event (older package / re-projection gap)
 * degrades to zeros (the banner shows "the zone lies quiet"), never throws.
 * @param {any} result the normalized receipt (`{ events: [{ type, parsedJson }] }`)
 * @returns {{ zx:number, zy:number, at_ms:number, mob_groups:number, resource_nodes:number }}
 */
export function read_zone_searched(result) {
  const ev = (result?.events ?? []).find((e) => String(e?.type ?? '').endsWith('::zones::ZoneSearched'))
  const j = ev?.parsedJson ?? {}
  return {
    zx: Number(j.zx ?? 0),
    zy: Number(j.zy ?? 0),
    at_ms: Number(j.at_ms ?? 0),
    mob_groups: Number(j.mob_groups ?? 0),
    resource_nodes: Number(j.resource_nodes ?? 0),
  }
}
