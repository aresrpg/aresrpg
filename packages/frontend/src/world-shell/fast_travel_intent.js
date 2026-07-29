// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const FRIEND_OFFLINE = 'fast_travel.friend_offline'
const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/** The freshest candidate carrying an ACCEPTED live pose, or null when nobody has one. A pose is a refinement
 *  of the landing coordinate — never the proof that a world is reachable (#1641). */
const freshest_posed = (candidates) =>
  candidates
    .filter(
      (candidate) =>
        candidate?.id &&
        candidate.cell?.ts > 0 &&
        Number.isFinite(candidate.position?.x) &&
        Number.isFinite(candidate.position?.z)
    )
    .reduce((freshest, candidate) => (!freshest || candidate.cell.ts > freshest.cell.ts ? candidate : freshest), null)

/**
 * Shape every player-menu target into an input for the ONE fast-travel reducer. In-world targets carry an id and
 * let the resolve edge read their route. Friend targets name the exact character to fly to, joined to the
 * matching world from the roster poll; the shared resolver verifies that character's /v1 document afterward.
 *
 * REACHABILITY IS THE READ LAYER'S (#1641). A friend seen by the presence stream but carrying no live pose used
 * to be refused as "a realm you can't reach" — a statement about the WORLD that no world fact backed. The pose
 * is optional now: with one, it seeds the landing coordinate; without one, the intent still names the character
 * and the resolver reads its world and anchor position from /v1. Only two things refuse here: a friend nobody
 * has seen at all (offline), and a roster route that positively names NO world.
 * @param {{
 *   kind?:'friend', id?:string|null, address?:string|null, name?:string,
 *   routes?:Array<{character_id:string,world_id:string|null}>
 * }} target
 * @param {Array<{id:string,cell?:{ts?:number},position?:{x:number,z:number}}>} [friend_peers]
 */
export function fast_travel_intent(target, friend_peers = []) {
  if (target.kind === 'friend') {
    if (!friend_peers.length) return { type: 'begin', refusal: FRIEND_OFFLINE }
    const routes = target.routes ?? []
    const posed = freshest_posed(friend_peers)
    const peer =
      posed ??
      friend_peers.find((candidate) => candidate?.id && routes.some((r) => r.character_id === candidate.id)) ??
      friend_peers.find((candidate) => candidate?.id)
    if (!peer) return { type: 'begin', refusal: REALM_UNREACHABLE }
    const route = routes.find((candidate) => candidate.character_id === peer.id)
    if (route && !route.world_id) return { type: 'begin', refusal: REALM_UNREACHABLE }
    const begin = {
      type: 'begin',
      character_id: peer.id,
      address: target.address ?? null,
      name: target.name ?? '',
      world_id: route?.world_id ?? null,
    }
    return posed ? { ...begin, x: Number(peer.position.x), z: Number(peer.position.z), live: true } : begin
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
