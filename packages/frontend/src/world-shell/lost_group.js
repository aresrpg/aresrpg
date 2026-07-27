// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #609 — ONLY A VICTORY CONSUMES A GROUP. A pure leaf (no imports on purpose): the claim records which group a
// world fight took, and settlement is the only place it can be given back — by then the claim is long over, so
// the fact travels as session state and this decides what settlement does with it.
/**
 * The group a settling fight must RELEASE (#609), as data: a lost OPEN-WORLD fight gives its claimed group back,
 * everything else releases nothing. `null` is the safe answer everywhere — `fight::release_group` REFUSES a
 * victory outcome, a dungeon room fight never claimed a world group, and a group whose row was never named
 * cannot be released without guessing which one it was.
 * @param {{ lost?:boolean, run_pass_id?:string|null, world_group?:any }} session
 * @returns {{ world_id:string, zx:number, zy:number, index:number }|null}
 */
export function lost_group_of({ lost = false, run_pass_id = null, world_group = null }) {
  if (!lost || run_pass_id) return null
  const { world_id, zx, zy, index } = world_group ?? {}
  if (!world_id || zx == null || zy == null || index == null) return null
  return { world_id, zx: Number(zx), zy: Number(zy), index: Number(index) }
}
