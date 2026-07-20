// Party reads live on the indexed `/v1` projection. Membership is character-keyed, so the selected character
// is the complete lookup key; no shared-object gRPC read or owner-wide roster inference remains here.

import { rpc_get } from '../rpc/client'

/**
 * @typedef {{ character: string, owner: string, order: number }} PartyMember
 * @typedef {{ id: string, leader_character: string, members: PartyMember[] }} Party
 */

/**
 * GET /v1/parties?character=<exact selected character>; null means that character is currently solo.
 * @param {string} character_id
 * @param {AbortSignal} [signal]
 */
export async function get_party(character_id, signal) {
  if (!character_id) return null
  return rpc_get('/v1/parties', { character: character_id }, signal)
}
