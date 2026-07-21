// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const FRIEND_OFFLINE = 'fast_travel.friend_offline'
const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/**
 * Shape every player-menu target into an input for the ONE fast-travel reducer. In-world targets carry an id and
 * let the resolve edge read their route. Friend targets join the current presence cell to the matching world from
 * the roster poll at action time; the shared resolver verifies the exact character's /v1 document afterward.
 * @param {{
 *   kind?:'friend', id?:string|null, address?:string|null, name?:string,
 *   routes?:Array<{character_id:string,world_id:string|null}>
 * }} target
 * @param {Array<{id:string,cell?:{ts?:number},position?:{x:number,z:number}}>} [friend_peers]
 */
export function fast_travel_intent(target, friend_peers = []) {
  if (target.kind === 'friend') {
    if (!friend_peers.length) return { type: 'begin', refusal: FRIEND_OFFLINE }
    const peer = friend_peers
      .filter(
        (candidate) =>
          candidate?.id &&
          candidate.cell?.ts > 0 &&
          Number.isFinite(candidate.position?.x) &&
          Number.isFinite(candidate.position?.z)
      )
      .reduce((freshest, candidate) => (!freshest || candidate.cell.ts > freshest.cell.ts ? candidate : freshest), null)
    if (!peer) return { type: 'begin', refusal: REALM_UNREACHABLE }
    const route = (target.routes ?? []).find((candidate) => candidate.character_id === peer.id)
    if (route && !route.world_id) return { type: 'begin', refusal: REALM_UNREACHABLE }
    return {
      type: 'begin',
      character_id: peer.id,
      address: target.address ?? null,
      name: target.name ?? '',
      world_id: route?.world_id ?? null,
      x: Number(peer.position.x),
      z: Number(peer.position.z),
      live: true,
    }
  }
  return {
    type: 'begin',
    character_id: target.id ?? null,
    address: target.address ?? null,
    name: target.name ?? '',
  }
}

/** @param {any} target @param {(input:any)=>void} dispatch @param {any[]} [friend_peers] */
export function dispatch_fast_travel(target, dispatch, friend_peers = []) {
  const intent = fast_travel_intent(target, friend_peers)
  dispatch(intent)
  return intent
}
