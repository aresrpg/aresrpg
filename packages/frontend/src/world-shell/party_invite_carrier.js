// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE INVITE CARRIER (#2008). `party::invite` records the intent on chain and emits NOTHING, so a leader's
// invitation reached nobody: the invitee's `incoming_invite` stayed null forever and its accept died at the guard.
// The carrier is an AUTHORITATIVE READ — `/v1/party-invites` — folded on the party store's EXISTING poll tick into
// the reducer's EXISTING inbound door. No new clock, no P2P (any peer could otherwise pop a signed-action card),
// and the pure reducer is untouched: this module only reads, decides which row is honest, and hands it over.

import { get_party_invites } from '../chain/read_party'
import { game_log } from '../core/log.js'
import i18n from '../i18n'
import { push_event_toast } from '../game/core/toast.js'
import { humanize_abort } from '../game/core/abort_copy.js'

import { resolve_character_name } from './character_name_resolve.js'

// `party_id:character_id` of every invitation this client has ANSWERED — refused with a signed decline, or (#2159)
// accepted, whose card dies at the click while the transaction executes behind it. Either answer removes the
// pending row on chain, but the projector needs a tick or two to notice — without this the very next poll would
// resurrect a card the player just dismissed, mid-transaction. Edge-local, like the store's pending-invite toast
// ids: the pure reducer never sees it, and each entry drains itself the moment the read stops listing its row.
const answered = new Set()

const key = (party_id, character_id) => `${party_id}:${character_id}`

/** Remember an answer until the read layer agrees with it. */
export function latch_answered_invite(party_id, character_id) {
  answered.add(key(party_id, character_id))
}

/** The answer did not stick — an accept transaction that EXECUTED and failed. The question is open again, so the
 *  poll must be allowed to carry it back (#2159); the edge resurfaces it immediately through the same door. */
export function release_answered_invite(party_id, character_id) {
  answered.delete(key(party_id, character_id))
}

/** Session reset — a new identity inherits nobody's answers. */
export function reset_answered_invites() {
  answered.clear()
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
 * the one already on screen, and any answer still latched.
 *
 * Draining is deliberately scoped to the rows this read is EVIDENCE about: a poll for character B says nothing
 * about an answer character A is still holding, and dropping A's would resurrect its card once selection moves back.
 */
function pick_pending_invite(invites, basis_character_id, party_id, incoming_invite) {
  const live = new Set(invites.map((invite) => key(invite?.party, basis_character_id)))
  for (const latched of answered)
    if (latched.endsWith(`:${basis_character_id}`) && !live.has(latched)) answered.delete(latched)

  const row = invites.find(
    (invite) =>
      typeof invite?.party === 'string' &&
      invite.party !== party_id &&
      !answered.has(key(invite.party, basis_character_id))
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

/**
 * ANSWER the card on screen — accept or decline, one body (#2159, owner ruling): THE CARD DIES AT THE CLICK. The
 * answer enters the reducer first, the question is gone, and the signed transaction executes behind it; the
 * click is latched here so a poll tick landing mid-flight cannot resurrect it. The ONLY honest exception is a
 * transaction that actually FAILED — then the question was never answered, so it comes back through the very
 * door above with the reason said out loud. Per the tx-retry burn law nothing here re-fires it: an executed
 * failure already burned its gas, and the player answers again or does not.
 *
 * This lives beside `fold_pending_invite` because it is the other half of ONE lifecycle — the module that
 * decides which invitation is honest to SHOW is the module that owns what happens when it is answered.
 * @param {{ party_id: string, invited_character_id: string, from_name?: string } | null} invite
 * @param {{ selected_character_id: () => string|null, dispatch: (input: any) => any,
 *           tx_phase: (patch: any) => void, adopt_party: (party_id: string, character_id: string) => void }} edge
 * @param {{ sign: (party_id: string, character_id: string) => Promise<any>, label: string, adopt: boolean }} leg
 */
export async function answer_pending_invite(invite, edge, { sign, label, adopt }) {
  if (!invite) return
  if (edge.selected_character_id() !== invite.invited_character_id) {
    // A card addressed to the character I just switched away from: drop it, sign nothing.
    edge.dispatch({ kind: 'intent', action: 'decline', character_id: edge.selected_character_id() })
    return
  }
  const { party_id, invited_character_id, from_name } = invite
  latch_answered_invite(party_id, invited_character_id)
  edge.dispatch({ kind: 'intent', action: 'answer_invite', character_id: invited_character_id })
  edge.tx_phase({ busy: true, error: null })
  try {
    await sign(party_id, invited_character_id)
    game_log('party', `invite ${label} for ${invited_character_id.slice(0, 10)}`)
    if (adopt) edge.adopt_party(party_id, invited_character_id)
  } catch (error) {
    game_log('party', `${label} failed`, error)
    release_answered_invite(party_id, invited_character_id)
    edge.dispatch({ kind: 'event', event: 'invite', party_id, invited_character_id, from_name })
    edge.tx_phase({ error: humanize_abort(error) })
    push_event_toast({ state: 'error', title: i18n.t('party.answer_failed_title'), message: humanize_abort(error) })
  }
  edge.tx_phase({ busy: false })
}
