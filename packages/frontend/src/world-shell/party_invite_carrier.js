// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE INVITE CARRIER (#2008). `party::invite` records the intent on chain and emits NOTHING, so a leader's
// invitation reached nobody: the invitee's `incoming_invite` stayed null forever and its accept died at the guard.
// The carrier is an AUTHORITATIVE READ — `/v1/party-invites` — folded on the party store's EXISTING poll tick into
// the reducer's EXISTING inbound door. No new clock, no P2P (any peer could otherwise pop a signed-action card),
// and the pure reducer is untouched: this module only reads, decides which row is honest, and hands it over.

import { get_party_invites } from '../chain/read_party'
import { game_log } from '../core/log.js'

import { resolve_character_name } from './character_name_resolve.js'

// `party_id:character_id` of every invitation refused with a signed decline. The decline removes the pending row on
// chain, but the projector needs a tick or two to notice — without this the very next poll would resurrect a card
// the player just dismissed. Edge-local, like the store's pending-invite toast ids: the pure reducer never sees it,
// and each entry drains itself the moment the authoritative read stops listing it.
const declined = new Set()

const key = (party_id, character_id) => `${party_id}:${character_id}`

/** Remember a refusal until the read layer agrees with it. */
export function latch_declined_invite(party_id, character_id) {
  declined.add(key(party_id, character_id))
}

/** Session reset — a new identity inherits nobody's refusals. */
export function reset_declined_invites() {
  declined.clear()
}

/** The pending dimension of the party poll. Fenced off on its own: a read-layer hiccup here must never cost the
 *  membership snapshot the whole party UI depends on, and a failure is logged, never swallowed as "no invites". */
export const read_pending_invites = (character_id) =>
  get_party_invites(character_id).catch((error) => {
    game_log('party', 'pending-invite read failed', error)
    return null
  })

/**
 * The one pending row to deliver for `basis_character_id`, or null. Skips an invitation for the party this
 * character is already bound to (the membership and pending projections can disagree for a tick after an accept),
 * the one already on screen, and any refusal still latched.
 *
 * Draining is deliberately scoped to the rows this read is EVIDENCE about: a poll for character B says nothing
 * about a refusal character A is still holding, and dropping A's would resurrect its card once selection moves back.
 */
function pick_pending_invite(invites, basis_character_id, party_id, incoming_invite) {
  const live = new Set(invites.map((invite) => key(invite?.party, basis_character_id)))
  for (const latched of declined)
    if (latched.endsWith(`:${basis_character_id}`) && !live.has(latched)) declined.delete(latched)

  const row = invites.find(
    (invite) =>
      typeof invite?.party === 'string' &&
      invite.party !== party_id &&
      !declined.has(key(invite.party, basis_character_id))
  )
  if (!row) return null
  const already_shown =
    incoming_invite?.party_id === row.party && incoming_invite.invited_character_id === basis_character_id
  return already_shown ? null : row
}

/**
 * Carry ONE authoritative pending invitation into the reducer's inbound `event:'invite'` door. The basis is fenced
 * twice — before the name resolve and after it — because a player switching characters mid-read must never end up
 * holding a card addressed to the character they just left.
 * @param {readonly any[]} invites
 * @param {string} basis_character_id
 * @param {{ party_id: string|null, incoming_invite: any, is_selected: () => boolean,
 *           dispatch: (input: any) => any }} edge
 */
export async function fold_pending_invite(invites, basis_character_id, edge) {
  const row = pick_pending_invite(invites, basis_character_id, edge.party_id, edge.incoming_invite)
  if (!row || !edge.is_selected()) return
  const from_name = row.leader_character ? await resolve_character_name(row.leader_character) : ''
  if (!edge.is_selected()) return
  edge.dispatch({
    kind: 'event',
    event: 'invite',
    party_id: row.party,
    invited_character_id: basis_character_id,
    from_name,
  })
}
