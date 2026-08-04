// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE-PIPELINE PARTY REDUCER (M1 template — CLIENT-INDEPENDENCE law, project CLAUDE.md Principle 6 +
// CLIENT_DESIGN_AUDIT row #4). Pure: no react/zustand/sdk/fetch/Date.now — `now` is injected, ambient identity
// (selected character, wallet address) arrives IN the input, so the SAME reducer drives the webapp store AND a
// headless CLI bot. `reduce(state, input) -> { state, outputs }`; effects (PTBs, p2p broadcast, polling, toasts,
// game_log) run at the EDGE, fed back as the next input. `project_party_view` is the renderer-agnostic view door.
//
// INPUTS   { intent(pre-tx guard/clear) | receipt_patch(own signed tx effects) | snapshot(/v1 read) | event(p2p) }
// ACTIONS  create · join · leave · kick · invite · accept · decline · elect_leader  (+ disband/switch_basis riders,
//          invite_sent/cancel_invite for the OUTGOING pending-invite toast lifecycle below, answer_invite for the
//          #2159 click-time dismissal of an incoming card)
// MERGE    basis fence (a read for A never binds after selection moves to B) · positive latch (_awaiting: our own
//          create/accept may beat the projector — hold the id) · negative latch (_departed: a just-left/kicked
//          character is refused re-adoption by a stale snapshot until it drops them or the deadline drains, M4) ·
//          idempotent dedupe (an already-applied poll frame is a no-op — no re-adopt, re-toast, or re-publish).
//
// OUTGOING PENDING INVITES (`pending_invites`, `outputs.pending_invite_requests`): party.move emits no decline
// event and exposes no leader-side revoke (verified against packages/move/social/sources/party.move — `invite` /
// `accept` / `decline` / `leave` / `kick` / `disband` is the complete entry surface), so a sent invite has exactly
// three HONEST resolutions the edge can ever observe: the invitee joins (folded below, same as any other `joined`
// member), the leader cancels locally (`cancel_invite` — dismisses our own toast only; the invite itself stays
// recorded on-chain, nothing to compose), or the TTL lapses (`INVITE_PENDING_TTL_MS`, checked for free on every
// poll-driven snapshot so no extra timer is needed). A declined invite is indistinguishable from an ignored one.

export const MAX_MEMBERS = 6
export const POLL_MS = 4000
export const DEPART_LATCH_MS = POLL_MS * 3
// An outgoing invite nobody ever answers (declines aren't a chain event — see header) would otherwise show a
// "loading" toast forever; 3 minutes is a generous real-human-decision window, drained by the existing poll tick.
export const INVITE_PENDING_TTL_MS = 3 * 60 * 1000

// Stable empty roster — a fresh [] each projection would thrash referential-equality selectors into re-render loops.
const EMPTY_MEMBERS = Object.freeze([])
// Same referential-stability reason, for the (usually empty) outgoing pending-invite toast request batch below.
const EMPTY_PENDING_REQUESTS = Object.freeze([])

const no_outputs = () => ({
  publish: false,
  joined: EMPTY_MEMBERS,
  divergence: null,
  stale_reread: false,
  pending_invite_requests: EMPTY_PENDING_REQUESTS,
})
const still = (state) => ({ state, outputs: no_outputs() })

export const has_character = (party, character_id) =>
  party?.members?.some((member) => member.character === character_id) ?? false

/** The bound party truly belongs to `character_id` (basis) AND still lists it — the guard every mutation shares. */
export const is_bound_member = (state, character_id) =>
  state._party_character_id === character_id && has_character(state.party, character_id)

/** Append one owned alt as a distinct confirmed member; never collapse a same-wallet sibling into an address slot. */
const with_member = (party, character_id, owner) =>
  has_character(party, character_id)
    ? party
    : {
        ...party,
        members: [
          ...(party?.members ?? []),
          { character: character_id, owner: owner ?? '', order: party?.members?.length ?? 0 },
        ],
      }

const parties_equal = (a, b) => {
  if (a === b) return true
  if (!a || !b || a.id !== b.id || a.leader_character !== b.leader_character) return false
  if ((a.members?.length ?? 0) !== (b.members?.length ?? 0)) return false
  return a.members.every((member, index) => {
    const other = b.members[index]
    return other && member.character === other.character && member.owner === other.owner && member.order === other.order
  })
}

export const empty_party_state = () => ({
  party_id: null,
  party: null,
  incoming_invite: null,
  pending_invites: [],
  incoming_dungeon_id: null,
  incoming_template_id: null,
  _awaiting_party_id: null,
  _awaiting_character_id: null,
  _departed: null,
  _party_character_id: null,
  _owned_join_blocked_ids: [],
})

// The renderer-agnostic party view — the ONE door the webapp (PartyFrame) and the CLI bot both read. Inner refs are
// referentially stable across identical frames (EMPTY_MEMBERS, the same `party.members`) so field selectors are safe.
export function project_party_view(state) {
  const members = state.party?.members ?? EMPTY_MEMBERS
  return {
    party_id: state.party_id,
    leader_character: state.party?.leader_character ?? null,
    members,
    size: members.length,
    is_solo: members.length < 2,
    capacity_left: Math.max(0, MAX_MEMBERS - members.length),
    incoming_invite: state.incoming_invite,
    pending_invites: state.pending_invites ?? EMPTY_MEMBERS,
    incoming_dungeon_id: state.incoming_dungeon_id,
    incoming_template_id: state.incoming_template_id,
  }
}

/** Pure guard for the invite intent: leadership + the six-slot hard stop, decided before any PTB. */
export function party_invite_verdict(state, leader_character_id) {
  if (!state.party || state.party.leader_character !== leader_character_id) return 'not_leader'
  if ((state.party.members?.length ?? 0) >= MAX_MEMBERS) return 'full'
  return 'ok'
}

/** Drop every outgoing pending invite matching `predicate` (default: all) and describe the dismiss requests the
 *  edge must issue for their toasts — shared by every branch that can strand one (leave/disband/switch_basis,
 *  the accept fold, and the TTL sweep in reduce_snapshot).
 *  @param {any} state @param {string} reason @param {(invite: any) => boolean} [predicate] */
const drop_pending_invites = (state, reason, predicate = () => true) => {
  const dropped = state.pending_invites.filter(predicate)
  if (!dropped.length) return { pending_invites: state.pending_invites, requests: EMPTY_PENDING_REQUESTS }
  return {
    pending_invites: state.pending_invites.filter((invite) => !predicate(invite)),
    requests: dropped.map((invite) => ({
      type: 'dismiss',
      party_id: invite.party_id,
      invited_character_id: invite.invited_character_id,
      reason,
    })),
  }
}

// ── receipt_patch: own signed tx effects (post-await) — the latch-setting membership writes ────────────────────────
function reduce_receipt(state, input) {
  switch (input.action) {
    case 'create': {
      const { party_id, character_id, address } = input
      return {
        state: {
          ...state,
          party_id,
          party: {
            id: party_id,
            leader_character: character_id,
            members: [{ character: character_id, owner: address ?? '', order: 0 }],
          },
          _awaiting_party_id: party_id,
          _awaiting_character_id: character_id,
          _party_character_id: character_id,
        },
        outputs: { ...no_outputs(), publish: true },
      }
    }
    case 'join': {
      const { character_id, address } = input
      if (!state.party) return still(state)
      return {
        state: { ...state, party: with_member(state.party, character_id, address) },
        outputs: { ...no_outputs(), publish: true },
      }
    }
    case 'accept': {
      // Adopt the id after our own accept tx; hold it (party=null, _awaiting) until the projection confirms.
      const { party_id, character_id } = input
      return {
        state: {
          ...state,
          party_id,
          party: null,
          incoming_invite: null,
          _awaiting_party_id: party_id,
          _awaiting_character_id: character_id,
          _party_character_id: character_id,
        },
        outputs: { ...no_outputs(), publish: true },
      }
    }
    case 'leave': {
      const { party_id, character_id, now } = input
      const { pending_invites, requests } = drop_pending_invites(state, 'left')
      return {
        state: {
          ...state,
          party_id: null,
          party: null,
          pending_invites,
          _awaiting_party_id: null,
          _awaiting_character_id: null,
          _party_character_id: null,
          _departed: { party_id, character_id, deadline: now + DEPART_LATCH_MS },
        },
        outputs: { ...no_outputs(), publish: true, pending_invite_requests: requests },
      }
    }
    case 'kick': {
      const { party_id, target_character_id, now } = input
      if (!state.party) return still(state)
      return {
        state: {
          ...state,
          party: {
            ...state.party,
            members: state.party.members.filter((member) => member.character !== target_character_id),
          },
          _departed: { party_id, character_id: target_character_id, deadline: now + DEPART_LATCH_MS },
        },
        // No publish: the leader stays put; the edge re-reads (refresh) to confirm the removal on-chain.
        outputs: no_outputs(),
      }
    }
    case 'disband': {
      const { pending_invites, requests } = drop_pending_invites(state, 'disbanded')
      return {
        state: {
          ...state,
          party_id: null,
          party: null,
          pending_invites,
          _awaiting_party_id: null,
          _awaiting_character_id: null,
          _party_character_id: null,
        },
        outputs: { ...no_outputs(), publish: true, pending_invite_requests: requests },
      }
    }
    default:
      return still(state)
  }
}

// ── intent: pre-tx guards / local clears (no chain round-trip needed for the state change) ─────────────────────────
function reduce_intent(state, input) {
  switch (input.action) {
    case 'decline':
      // The signed decline removes intent without membership; character-mismatch is fenced at the edge.
      return state.incoming_invite
        ? { state: { ...state, incoming_invite: null }, outputs: no_outputs() }
        : still(state)
    case 'answer_invite': {
      // #2159 (owner ruling) — THE CARD DIES AT THE CLICK. An invitation is a question, and the moment its
      // owner answers it there is nothing left to ask: the accept/decline transaction executes BEHIND this
      // input, it does not gate it. Membership itself is untouched here — only the signed accept's receipt
      // (`receipt_patch action:'accept'`) may ever adopt a party id. A transaction that ultimately FAILS puts
      // the question back through the ordinary inbound door (`event:'invite'`), so nothing is latched here and
      // this stays one honest clear rather than a second home for a pending answer.
      const { character_id } = input
      return state.incoming_invite?.invited_character_id === character_id
        ? { state: { ...state, incoming_invite: null }, outputs: no_outputs() }
        : still(state)
    }
    case 'invite_sent': {
      // The leader's own invite tx just executed — arm the OUTGOING pending toast (see header). Re-sending to the
      // same character refreshes its deadline instead of stacking a second entry (the edge also guards this).
      const { party_id, invited_character_id, invited_name, now } = input
      const name = String(invited_name ?? '')
      const rest = state.pending_invites.filter((invite) => invite.invited_character_id !== invited_character_id)
      return {
        state: {
          ...state,
          pending_invites: [
            ...rest,
            { party_id, invited_character_id, invited_name: name, deadline: now + INVITE_PENDING_TTL_MS },
          ],
        },
        outputs: {
          ...no_outputs(),
          pending_invite_requests: [{ type: 'open', party_id, invited_character_id, invited_name: name }],
        },
      }
    }
    case 'cancel_invite': {
      // Local-only (no on-chain revoke exists, see header): dismiss our own toast, the invite stays pending.
      const { party_id, invited_character_id } = input
      const { pending_invites, requests } = drop_pending_invites(
        state,
        'cancelled',
        (invite) => invite.party_id === party_id && invite.invited_character_id === invited_character_id
      )
      return requests.length
        ? { state: { ...state, pending_invites }, outputs: { ...no_outputs(), pending_invite_requests: requests } }
        : still(state)
    }
    case 'elect_leader': {
      // Optimistically predict the chain's leadership hand-off (Move elects the oldest survivor); the snapshot reconciles.
      const { character_id } = input
      if (!state.party || !has_character(state.party, character_id) || state.party.leader_character === character_id)
        return still(state)
      return {
        state: { ...state, party: { ...state.party, leader_character: character_id } },
        outputs: { ...no_outputs(), publish: true },
      }
    }
    case 'block_owned_join': {
      // Memoize an owned alt whose join tx EXECUTED and failed (digest exists — never auto-retried, D747 class).
      const { character_id } = input
      if (!character_id || state._owned_join_blocked_ids.includes(character_id)) return still(state)
      return {
        state: { ...state, _owned_join_blocked_ids: [...state._owned_join_blocked_ids, character_id] },
        outputs: no_outputs(),
      }
    }
    case 'switch_basis': {
      // Selection moved to `to_character_id`: drop A's stale binding + a stale invite so the next read may bind B.
      const { to_character_id } = input
      const drop_invite = !!state.incoming_invite && state.incoming_invite.invited_character_id !== to_character_id
      const drop_binding = !!state._party_character_id && state._party_character_id !== to_character_id
      if (!drop_invite && !drop_binding) return still(state)
      const invite = drop_invite ? null : state.incoming_invite
      if (!drop_binding) return { state: { ...state, incoming_invite: invite }, outputs: no_outputs() }
      const { pending_invites, requests } = drop_pending_invites(state, 'switched')
      return {
        state: {
          ...state,
          incoming_invite: invite,
          party_id: null,
          party: null,
          pending_invites,
          _awaiting_party_id: null,
          _awaiting_character_id: null,
          _party_character_id: null,
          _owned_join_blocked_ids: [],
        },
        outputs: { ...no_outputs(), pending_invite_requests: requests },
      }
    }
    default:
      return still(state)
  }
}

// ── event: p2p nudges (UX-only; signed consent still owns membership) ──────────────────────────────────────────────
function reduce_event(state, input) {
  switch (input.event) {
    case 'invite':
      return {
        state: {
          ...state,
          incoming_invite: {
            party_id: input.party_id,
            invited_character_id: input.invited_character_id,
            from_name: String(input.from_name ?? ''),
          },
        },
        outputs: no_outputs(),
      }
    case 'dungeon_share':
      return {
        state: { ...state, incoming_dungeon_id: input.dungeon_id, incoming_template_id: input.template_id },
        outputs: no_outputs(),
      }
    case 'clear_dungeon':
      return { state: { ...state, incoming_dungeon_id: null, incoming_template_id: null }, outputs: no_outputs() }
    default:
      return still(state)
  }
}

// ── snapshot: the /v1 read reconcile — basis fence, positive/negative latches, dedupe, join detection ──────────────
function reduce_snapshot_core(state, { basis, current, party, now }) {
  // Basis fence: a read issued for `basis` must never bind after the live selection moved to `current`.
  if (current !== basis) return { state, outputs: { ...no_outputs(), stale_reread: true } }

  if (!party || !has_character(party, basis)) {
    // Positive latch: our own create/accept can beat the event projector — keep the known id until its first row.
    if (
      state._awaiting_party_id &&
      state._awaiting_character_id === basis &&
      state.party_id === state._awaiting_party_id
    )
      return still(state)
    // Idempotent dedupe: already solo with nothing pending → a redundant solo poll is a no-op (no re-publish).
    if (
      state.party_id === null &&
      state.party === null &&
      state._party_character_id === null &&
      state._departed === null
    )
      return still(state)
    // A genuine solo confirmation (leave/kick/disband): clear local membership and drain the departed latch.
    const { pending_invites, requests } = drop_pending_invites(state, 'party_ended')
    return {
      state: { ...state, party_id: null, party: null, pending_invites, _party_character_id: null, _departed: null },
      outputs: { ...no_outputs(), publish: true, pending_invite_requests: requests },
    }
  }

  if (party.members.length > MAX_MEMBERS) return still(state) // reject an over-cap projection; hold current state

  // Negative latch (M4): refuse to re-adopt a just-departed member while a stale frame still lists them.
  let next_departed = state._departed
  let divergence = null
  if (state._departed?.party_id === party.id) {
    const still_listed = has_character(party, state._departed.character_id)
    if (still_listed && now < state._departed.deadline) return still(state) // within the window — refuse
    // Deadline passed yet the chain STILL lists them: our optimistic removal diverged from chain. Adopt chain + log.
    if (still_listed)
      divergence = {
        party_id: party.id,
        character_id: state._departed.character_id,
        predicted: 'departed',
        snapshot: 'present',
      }
    next_departed = null // the frame dropped them (or the deadline forced a resync) — drain
  }

  const latch_settled = next_departed === state._departed && !state._awaiting_party_id
  // Idempotent dedupe: an identical, already-applied frame with no latch work pending is a no-op.
  if (state.party_id === party.id && parties_equal(state.party, party) && latch_settled) return still(state)

  const previous = state.party
  const joined = previous
    ? party.members
        .filter((member) => !previous.members.some((old) => old.character === member.character))
        .map((member) => member.character)
    : EMPTY_MEMBERS

  // A member who just joined resolves any outgoing invite WE sent them (D80: one toast, folded away by the event
  // that answers it — never left for the leader to notice and close by hand).
  const { pending_invites, requests: pending_invite_requests } = drop_pending_invites(state, 'accepted', (invite) =>
    joined.includes(invite.invited_character_id)
  )

  return {
    state: {
      ...state,
      party_id: party.id,
      party,
      pending_invites,
      _awaiting_party_id: null,
      _awaiting_character_id: null,
      _party_character_id: basis,
      _departed: next_departed,
    },
    outputs: { ...no_outputs(), joined, divergence, publish: state.party_id !== party.id, pending_invite_requests },
  }
}

// TTL sweep for a sent invite nobody ever answers (see header) — reuses the poll-supplied `now`, no extra timer.
// Runs AFTER the core fold so an accept detected on the SAME tick always wins (drop_pending_invites can never
// double-process one entry: once the core drops it, the wrapper's own filter can no longer match it).
function reduce_snapshot(state, input) {
  const result = reduce_snapshot_core(state, input)
  const { pending_invites, requests } = drop_pending_invites(
    result.state,
    'expired',
    (invite) => input.now >= invite.deadline
  )
  if (!requests.length) return result
  return {
    state: { ...result.state, pending_invites },
    outputs: {
      ...result.outputs,
      pending_invite_requests: [...result.outputs.pending_invite_requests, ...requests],
    },
  }
}

/**
 * @param {any} state domain party state (busy/error/timer live at the edge, never here)
 * @param {any} input { kind:'intent'|'receipt_patch'|'snapshot'|'event', ... }
 * @returns {{ state: any, outputs: { publish: boolean, joined: readonly string[], divergence: any, stale_reread: boolean, pending_invite_requests: readonly any[] } }}
 */
export function reduce(state, input) {
  switch (input?.kind) {
    case 'receipt_patch':
      return reduce_receipt(state, input)
    case 'intent':
      return reduce_intent(state, input)
    case 'event':
      return reduce_event(state, input)
    case 'snapshot':
      return reduce_snapshot(state, input)
    default:
      return still(state)
  }
}
