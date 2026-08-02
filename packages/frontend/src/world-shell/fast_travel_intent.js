// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

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
 * ADVISORY-ONLY LAW (realtime constitution D2). A peer observation is an observation: it may REFINE which of the
 * friend's own /v1-named characters we aim at and where exactly we land, and nothing else. It may not name a
 * target the authoritative read never named, and its ABSENCE means UNKNOWN — never "offline", never a refusal.
 * So the roster's /v1 routes decide, the observation only sharpens, and the stream's own health is not an input.
 * ONE refusal remains, and it states only what the authoritative read proved: the roster names this friend's
 * characters and positively places NONE of them in a world.
 * @param {{
 *   kind?:'friend', id?:string|null, address?:string|null, name?:string,
 *   routes?:Array<{character_id:string,world_id:string|null}>
 * }} target
 * @param {Array<{id:string,cell?:{ts?:number},position?:{x:number,z:number}}>} [observed_peers] advisory peer
 *   observations — a coordinate hint, never an authority on who or where anyone is.
 */
export function fast_travel_intent(target, observed_peers = []) {
  if (target.kind === 'friend') {
    const routes = target.routes ?? []
    // AUTHORITY: the /v1 roster read names this friend's characters and the world each one stands in.
    const reachable = routes.filter((route) => route.world_id)
    // ADVISORY: only an observation OF one of those authoritative characters counts, so a self-declared id the
    // roster never named can neither become the target nor drag the landing coordinate anywhere.
    const observed = freshest_posed(
      observed_peers.filter((peer) => reachable.some((route) => route.character_id === peer?.id))
    )
    const route = reachable.find((candidate) => candidate.character_id === observed?.id) ?? reachable[0] ?? null
    if (!route && routes.length) return { type: 'begin', refusal: REALM_UNREACHABLE }
    const begin = {
      type: 'begin',
      // No route means the roster resolved no character for this wallet: name the wallet and let the resolver
      // read /v1 by owner. Guessing a peer-carried id here is exactly the identity leak this law forbids.
      character_id: route?.character_id ?? null,
      address: target.address ?? null,
      name: target.name ?? '',
      world_id: route?.world_id ?? null,
    }
    return observed?.id === route?.character_id && observed
      ? { ...begin, x: Number(observed.position.x), z: Number(observed.position.z), live: true }
      : begin
  }
  return {
    type: 'begin',
    character_id: target.id ?? null,
    address: target.address ?? null,
    name: target.name ?? '',
  }
}

/** @param {any} target @param {(input:any)=>void} dispatch @param {any[]} [observed_peers] */
export function dispatch_fast_travel(target, dispatch, observed_peers = []) {
  const intent = fast_travel_intent(target, observed_peers)
  dispatch(intent)
  return intent
}
