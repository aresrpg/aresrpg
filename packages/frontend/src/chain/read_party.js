// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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

/**
 * GET /v1/party-invites?character=<exact selected character> — the parties currently holding a PENDING invitation
 * for it. THE invite carrier (#2008): `party::invite` records the intent on chain and emits no event, so this
 * authoritative read is the only honest delivery path; a P2P message could never be trusted to pop a signed-action
 * card. Always an array — an empty one means nobody has invited this character.
 * @param {string} character_id
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ party: string, leader_character: string }[]>}
 */
export async function get_party_invites(character_id, signal) {
  if (!character_id) return []
  const invites = await rpc_get('/v1/party-invites', { character: character_id }, signal)
  return Array.isArray(invites) ? invites : []
}
