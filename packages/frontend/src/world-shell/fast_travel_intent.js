// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const FRIEND_OFFLINE = 'fast_travel.friend_offline'
const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'
const PRESENCE_DOWN = 'fast_travel.presence_down'
// Presence has ONE read stream. When that stream is dead or was never opened, we do not know where anybody is
// — and an outage must be loud, never a sentence about the world ("a realm you can't reach") that no world
// fact backs. `connecting`/`reconnecting` are still trying, so they are not an outage.
const presence_is_down = (link_status) => link_status === 'failed' || link_status === 'idle'

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
 * and the resolver reads its world and anchor position from /v1. Three things refuse here, each naming its own
 * truth: a dead presence stream (an outage), a friend nobody has seen at all (offline), and a roster route that
 * positively names NO world.
 * @param {{
 *   kind?:'friend', id?:string|null, address?:string|null, name?:string,
 *   routes?:Array<{character_id:string,world_id:string|null}>
 * }} target
 * @param {Array<{id:string,cell?:{ts?:number},position?:{x:number,z:number}}>} [friend_peers] read from the
 *   presence atom the SSE stream feeds — never a private cache that outlives the stream.
 * @param {string} [link_status] the presence stream's own state; a caller that cannot observe it says nothing
 *   about the link rather than inventing an outage.
 */
export function fast_travel_intent(target, friend_peers = [], link_status = 'connected') {
  if (target.kind === 'friend') {
    const outage = presence_is_down(link_status)
    if (!friend_peers.length) return { type: 'begin', refusal: outage ? PRESENCE_DOWN : FRIEND_OFFLINE }
    const routes = target.routes ?? []
    const posed = freshest_posed(friend_peers)
    const peer =
      posed ??
      friend_peers.find((candidate) => candidate?.id && routes.some((r) => r.character_id === candidate.id)) ??
      friend_peers.find((candidate) => candidate?.id)
    if (!peer) return { type: 'begin', refusal: outage ? PRESENCE_DOWN : REALM_UNREACHABLE }
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

/** @param {any} target @param {(input:any)=>void} dispatch @param {any[]} [friend_peers] @param {string} [link_status] */
export function dispatch_fast_travel(target, dispatch, friend_peers = [], link_status = 'connected') {
  const intent = fast_travel_intent(target, friend_peers, link_status)
  dispatch(intent)
  return intent
}
