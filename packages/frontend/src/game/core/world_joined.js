// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WorldJoined event decode — the join-tx twin of zone_searched.js's ZoneSearched decoder. FIRST JOIN rolls the
// character's spawn position via on-chain `&Random` (zones::join_internal) — the client cannot predict it
// offline, so the event is the ONLY place the exact position is knowable, and it rides the SAME receipt the
// join tx already returns. Reading it here (once, off the tx the client itself just submitted) is what lets
// world_checkpoint.js seed the boot-spawn cache WITHOUT waiting on a second chain-direct DF read that can still
// be resolving/lagging behind the very write it's trying to observe — the exact "empty shell waiting on a ping"
// PIPELINE LAW forbids. Pins the on-chain event identity: `zones.move` emits
// `WorldJoined { world, character, x, z, first_join }`; a rename there must break THIS decoder, not silently
// leave every fresh join to fall back to the WORLD_SPAWN guess.

/**
 * Read the `WorldJoined` event off a run_tx/sponsor normalized receipt → `{ x, z, first_join }` (UNSIGNED CHAIN
 * block coords). Absent event (older package / re-projection gap / a receipt shape with no events) degrades to
 * null — never throws; the caller falls back to the existing chain-direct checkpoint read.
 * @param {any} result the normalized receipt (`{ events: [{ type, parsedJson }] }`)
 * @returns {{ x:number, z:number, first_join:boolean } | null}
 */
export function read_world_joined(result) {
  const ev = (result?.events ?? []).find((e) => String(e?.type ?? '').endsWith('::zones::WorldJoined'))
  const j = ev?.parsedJson
  if (!j) return null
  const x = Number(j.x)
  const z = Number(j.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return { x, z, first_join: !!j.first_join }
}
