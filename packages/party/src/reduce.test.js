// Pure party reducer — per Action, per input kind, the negative latch (M4 audit row 4), idempotent dedupe, and the
// deadline-drain divergence. Fixtures are the REAL /v1 party projection shape ({ id, leader_character, members:
// [{ character, owner, order }] }, from read_party.js + party_store.character.test.js), never fabricated.
import { expect, test } from 'bun:test'

import {
  reduce,
  project_party_view,
  party_invite_verdict,
  is_bound_member,
  empty_party_state,
  DEPART_LATCH_MS,
  MAX_MEMBERS,
  INVITE_PENDING_TTL_MS,
} from './reduce.js'

const NOW = 1_000_000
const party = {
  id: '0xparty',
  leader_character: '0xleader',
  members: [
    { character: '0xleader', owner: '0xleader-owner', order: 0 },
    { character: '0xinvited', owner: '0xwallet', order: 1 },
  ],
}
const bound = () => ({ ...empty_party_state(), party_id: party.id, party, _party_character_id: '0xinvited' })

// ── receipt_patch (own signed tx effects) ─────────────────────────────────────────────────────────────────────────
test('receipt_patch/create binds the solo leader party, arms the positive latch, and publishes', () => {
  const { state, outputs } = reduce(empty_party_state(), {
    kind: 'receipt_patch',
    action: 'create',
    party_id: '0xnew',
    character_id: '0xleader',
    address: '0xwallet',
  })
  expect(state.party).toEqual({
    id: '0xnew',
    leader_character: '0xleader',
    members: [{ character: '0xleader', owner: '0xwallet', order: 0 }],
  })
  expect(state._awaiting_party_id).toBe('0xnew')
  expect(state._awaiting_character_id).toBe('0xleader')
  expect(state._party_character_id).toBe('0xleader')
  expect(outputs.publish).toBe(true)
})

test('receipt_patch/join appends an owned alt as a distinct member, never an address slot', () => {
  const start = {
    ...empty_party_state(),
    party_id: '0xnew',
    party: {
      id: '0xnew',
      leader_character: '0xleader',
      members: [{ character: '0xleader', owner: '0xwallet', order: 0 }],
    },
  }
  const { state } = reduce(start, { kind: 'receipt_patch', action: 'join', character_id: '0xalt', address: '0xwallet' })
  expect(state.party.members.map((m) => m.character)).toEqual(['0xleader', '0xalt'])
  // idempotent — the same alt does not duplicate
  const { state: again } = reduce(state, {
    kind: 'receipt_patch',
    action: 'join',
    character_id: '0xalt',
    address: '0xwallet',
  })
  expect(again.party.members.map((m) => m.character)).toEqual(['0xleader', '0xalt'])
})

test('receipt_patch/accept adopts the id, holds (party=null + awaiting), and clears the incoming invite', () => {
  const start = {
    ...empty_party_state(),
    incoming_invite: { party_id: party.id, invited_character_id: '0xinvited', from_name: 'L' },
  }
  const { state, outputs } = reduce(start, {
    kind: 'receipt_patch',
    action: 'accept',
    party_id: party.id,
    character_id: '0xinvited',
  })
  expect(state.party_id).toBe(party.id)
  expect(state.party).toBe(null)
  expect(state._awaiting_party_id).toBe(party.id)
  expect(state.incoming_invite).toBe(null)
  expect(outputs.publish).toBe(true)
})

test('receipt_patch/leave clears membership and arms the departed negative latch (M4)', () => {
  const { state, outputs } = reduce(bound(), {
    kind: 'receipt_patch',
    action: 'leave',
    party_id: party.id,
    character_id: '0xinvited',
    now: NOW,
  })
  expect(state.party_id).toBe(null)
  expect(state.party).toBe(null)
  expect(state._departed).toEqual({ party_id: party.id, character_id: '0xinvited', deadline: NOW + DEPART_LATCH_MS })
  expect(outputs.publish).toBe(true)
})

test('receipt_patch/kick removes the target locally and arms the departed latch, without a publish', () => {
  const leader_view = { ...bound(), _party_character_id: '0xleader' }
  const { state, outputs } = reduce(leader_view, {
    kind: 'receipt_patch',
    action: 'kick',
    party_id: party.id,
    target_character_id: '0xinvited',
    now: NOW,
  })
  expect(state.party.members.map((m) => m.character)).toEqual(['0xleader'])
  expect(state._departed).toEqual({ party_id: party.id, character_id: '0xinvited', deadline: NOW + DEPART_LATCH_MS })
  expect(outputs.publish).toBe(false)
})

// ── intent (pre-tx guard / local clear) ───────────────────────────────────────────────────────────────────────────
test('intent/invite verdict enforces leadership and the six-slot hard stop', () => {
  const leader_view = { ...bound(), party: { ...party, leader_character: '0xinvited' } }
  expect(party_invite_verdict(leader_view, '0xinvited')).toBe('ok')
  expect(party_invite_verdict(bound(), '0xinvited')).toBe('not_leader') // 0xinvited is not the leader
  const full = {
    ...bound(),
    party: {
      ...party,
      leader_character: '0xinvited',
      members: Array.from({ length: MAX_MEMBERS }, (_, order) => ({
        character: order === 0 ? '0xinvited' : `0xc${order}`,
        owner: '0xo',
        order,
      })),
    },
  }
  expect(party_invite_verdict(full, '0xinvited')).toBe('full')
})

test('intent/decline clears the incoming invite (membership untouched)', () => {
  const start = {
    ...empty_party_state(),
    incoming_invite: { party_id: party.id, invited_character_id: '0xinvited', from_name: 'L' },
  }
  const { state } = reduce(start, { kind: 'intent', action: 'decline', character_id: '0xinvited' })
  expect(state.incoming_invite).toBe(null)
})

test('intent/elect_leader optimistically predicts the leadership hand-off; a no-op when invalid', () => {
  const { state, outputs } = reduce(bound(), { kind: 'intent', action: 'elect_leader', character_id: '0xinvited' })
  expect(state.party.leader_character).toBe('0xinvited')
  expect(outputs.publish).toBe(true)
  const same = bound()
  expect(reduce(same, { kind: 'intent', action: 'elect_leader', character_id: '0xleader' }).state).toBe(same) // already leader → unchanged ref
  expect(reduce(same, { kind: 'intent', action: 'elect_leader', character_id: '0xstranger' }).state).toBe(same) // not a member → unchanged
})

test('intent/switch_basis drops A binding + a stale invite so the next read may bind B', () => {
  const start = {
    ...bound(),
    incoming_invite: { party_id: party.id, invited_character_id: '0xinvited', from_name: 'L' },
  }
  const { state } = reduce(start, { kind: 'intent', action: 'switch_basis', to_character_id: '0xcharacter-b' })
  expect(state.party_id).toBe(null)
  expect(state.party).toBe(null)
  expect(state._party_character_id).toBe(null)
  expect(state.incoming_invite).toBe(null)
})

test('intent/block_owned_join memoizes an executed-failure alt exactly once (reducer-owned, deduped)', () => {
  const first = reduce(empty_party_state(), { kind: 'intent', action: 'block_owned_join', character_id: '0xalt' })
  expect(first.state._owned_join_blocked_ids).toEqual(['0xalt'])
  const again = reduce(first.state, { kind: 'intent', action: 'block_owned_join', character_id: '0xalt' })
  expect(again.state).toBe(first.state) // idempotent — no new state object, no re-publish
  const missing = reduce(first.state, { kind: 'intent', action: 'block_owned_join', character_id: null })
  expect(missing.state).toBe(first.state)
  // switch_basis still drains the memo with the rest of the basis-bound state
  const { state } = reduce(
    { ...first.state, _party_character_id: '0xinvited' },
    { kind: 'intent', action: 'switch_basis', to_character_id: '0xcharacter-b' }
  )
  expect(state._owned_join_blocked_ids).toEqual([])
})

// ── intent/invite_sent · intent/cancel_invite (UX: a loading toast until the invite is accepted/refused, with
//    a cancel button) — party.move has no leader-side revoke, so cancel is a LOCAL-ONLY dismiss (D759 audit). ──────
test('intent/invite_sent arms the outgoing pending toast with the resolved invitee name (RED-FIRST #1)', () => {
  const { state, outputs } = reduce(bound(), {
    kind: 'intent',
    action: 'invite_sent',
    party_id: party.id,
    invited_character_id: '0xtarget',
    invited_name: 'Ares',
    now: NOW,
  })
  expect(state.pending_invites).toEqual([
    {
      party_id: party.id,
      invited_character_id: '0xtarget',
      invited_name: 'Ares',
      deadline: NOW + INVITE_PENDING_TTL_MS,
    },
  ])
  expect(outputs.pending_invite_requests).toEqual([
    { type: 'open', party_id: party.id, invited_character_id: '0xtarget', invited_name: 'Ares' },
  ])
})

test('intent/invite_sent re-sending to the same character refreshes the deadline instead of stacking a 2nd toast', () => {
  const first = reduce(bound(), {
    kind: 'intent',
    action: 'invite_sent',
    party_id: party.id,
    invited_character_id: '0xtarget',
    invited_name: 'Ares',
    now: NOW,
  }).state
  const { state } = reduce(first, {
    kind: 'intent',
    action: 'invite_sent',
    party_id: party.id,
    invited_character_id: '0xtarget',
    invited_name: 'Ares',
    now: NOW + 1,
  })
  expect(state.pending_invites).toHaveLength(1)
  expect(state.pending_invites[0].deadline).toBe(NOW + 1 + INVITE_PENDING_TTL_MS)
})

test('intent/cancel_invite dismisses LOCALLY — the chain has no revoke, so nothing else is requested (RED-FIRST #3)', () => {
  const armed = reduce(bound(), {
    kind: 'intent',
    action: 'invite_sent',
    party_id: party.id,
    invited_character_id: '0xtarget',
    invited_name: 'Ares',
    now: NOW,
  }).state
  const { state, outputs } = reduce(armed, {
    kind: 'intent',
    action: 'cancel_invite',
    party_id: party.id,
    invited_character_id: '0xtarget',
  })
  expect(state.pending_invites).toEqual([])
  expect(outputs.pending_invite_requests).toEqual([
    { type: 'dismiss', party_id: party.id, invited_character_id: '0xtarget', reason: 'cancelled' },
  ])
  // A cancel for an invite that isn't tracked (already resolved/never sent) is a pure no-op — never a phantom dismiss.
  const noop = reduce(state, {
    kind: 'intent',
    action: 'cancel_invite',
    party_id: party.id,
    invited_character_id: '0xtarget',
  })
  expect(noop.state).toBe(state)
  expect(noop.outputs.pending_invite_requests).toEqual([])
})

test('intent/switch_basis also drops a stranded outgoing pending invite (no toast left orphaned behind character B)', () => {
  const armed = reduce(bound(), {
    kind: 'intent',
    action: 'invite_sent',
    party_id: party.id,
    invited_character_id: '0xtarget',
    invited_name: 'Ares',
    now: NOW,
  }).state
  const { state, outputs } = reduce(armed, { kind: 'intent', action: 'switch_basis', to_character_id: '0xcharacter-b' })
  expect(state.pending_invites).toEqual([])
  expect(outputs.pending_invite_requests).toEqual([
    { type: 'dismiss', party_id: party.id, invited_character_id: '0xtarget', reason: 'switched' },
  ])
})

// ── event (p2p nudge) ─────────────────────────────────────────────────────────────────────────────────────────────
test('event/invite records the p2p nudge as an incoming invite', () => {
  const { state } = reduce(empty_party_state(), {
    kind: 'event',
    event: 'invite',
    party_id: party.id,
    invited_character_id: '0xinvited',
    from_name: 'Leader',
  })
  expect(state.incoming_invite).toEqual({ party_id: party.id, invited_character_id: '0xinvited', from_name: 'Leader' })
})

test('event/dungeon_share and clear_dungeon set and clear the incoming dungeon hand-off', () => {
  const { state } = reduce(empty_party_state(), {
    kind: 'event',
    event: 'dungeon_share',
    dungeon_id: '0xdungeon',
    template_id: '0xtpl',
  })
  expect(state.incoming_dungeon_id).toBe('0xdungeon')
  expect(reduce(state, { kind: 'event', event: 'clear_dungeon' }).state.incoming_dungeon_id).toBe(null)
})

// ── snapshot (the /v1 read reconcile) ─────────────────────────────────────────────────────────────────────────────
test('snapshot basis fence: a read for A never binds after the live selection moved to B', () => {
  const { state, outputs } = reduce(bound(), {
    kind: 'snapshot',
    basis: '0xinvited',
    current: '0xcharacter-b',
    party,
    now: NOW,
  })
  expect(outputs.stale_reread).toBe(true)
  expect(state).toEqual(bound()) // unchanged
})

test('snapshot positive latch: our own create can beat the projector — a null frame holds the known id', () => {
  const awaiting = {
    ...empty_party_state(),
    party_id: '0xnew',
    _awaiting_party_id: '0xnew',
    _awaiting_character_id: '0xleader',
    _party_character_id: '0xleader',
  }
  const { state } = reduce(awaiting, {
    kind: 'snapshot',
    basis: '0xleader',
    current: '0xleader',
    party: null,
    now: NOW,
  })
  expect(state.party_id).toBe('0xnew') // held, not cleared
})

test('snapshot adopt: a fresh frame binds, clears the positive latch, and flags newly joined members', () => {
  const awaiting = {
    ...empty_party_state(),
    party_id: party.id,
    _awaiting_party_id: party.id,
    _awaiting_character_id: '0xinvited',
    _party_character_id: '0xinvited',
    party: {
      id: party.id,
      leader_character: '0xleader',
      members: [{ character: '0xleader', owner: '0xleader-owner', order: 0 }],
    },
  }
  const { state, outputs } = reduce(awaiting, {
    kind: 'snapshot',
    basis: '0xinvited',
    current: '0xinvited',
    party,
    now: NOW,
  })
  expect(state.party).toEqual(party)
  expect(state._awaiting_party_id).toBe(null)
  expect(outputs.joined).toEqual(['0xinvited']) // present now, absent before
})

test('snapshot negative latch — leave: a stale frame still listing the departed self is REFUSED, not re-adopted', () => {
  const departed = {
    ...empty_party_state(),
    _departed: { party_id: party.id, character_id: '0xinvited', deadline: NOW + DEPART_LATCH_MS },
  }
  const { state } = reduce(departed, { kind: 'snapshot', basis: '0xinvited', current: '0xinvited', party, now: NOW }) // party still lists 0xinvited
  expect(state.party_id).toBe(null) // refused — the phantom re-join is blocked
  expect(state.party).toBe(null)
})

test('snapshot negative latch — kick: a stale frame is refused and the optimistic removal survives', () => {
  const kicked_party = { ...party } // still lists the kicked 0xinvited (indexer lag)
  const optimistic = {
    ...bound(),
    _party_character_id: '0xleader',
    party: { ...party, members: [party.members[0]] },
    _departed: { party_id: party.id, character_id: '0xinvited', deadline: NOW + DEPART_LATCH_MS },
  }
  const { state } = reduce(optimistic, {
    kind: 'snapshot',
    basis: '0xleader',
    current: '0xleader',
    party: kicked_party,
    now: NOW,
  })
  expect(state.party.members.map((m) => m.character)).toEqual(['0xleader']) // optimistic removal held
})

test('snapshot latch drain: once the frame drops the departed member, the latch clears and a genuine re-join binds', () => {
  const departed = {
    ...empty_party_state(),
    _departed: { party_id: party.id, character_id: '0xinvited', deadline: NOW + DEPART_LATCH_MS },
  }
  const solo = reduce(departed, {
    kind: 'snapshot',
    basis: '0xinvited',
    current: '0xinvited',
    party: null,
    now: NOW,
  }).state
  expect(solo._departed).toBe(null) // drained by the frame dropping them
  const { state } = reduce(solo, { kind: 'snapshot', basis: '0xinvited', current: '0xinvited', party, now: NOW + 1 })
  expect(state.party).toEqual(party) // genuine re-join is no longer blocked
})

test('snapshot idempotent dedupe: an already-applied identical frame is a no-op (no re-adopt, no publish)', () => {
  const start = bound()
  const { state, outputs } = reduce(start, {
    kind: 'snapshot',
    basis: '0xinvited',
    current: '0xinvited',
    party,
    now: NOW,
  })
  expect(state).toBe(start) // same reference — deduped
  expect(outputs.publish).toBe(false)
  expect(outputs.joined).toEqual([])
})

test('snapshot divergence: the deadline drains but the chain STILL lists the departed → adopt chain + log divergence', () => {
  const departed = {
    ...empty_party_state(),
    _departed: { party_id: party.id, character_id: '0xinvited', deadline: NOW },
  }
  const { state, outputs } = reduce(departed, {
    kind: 'snapshot',
    basis: '0xinvited',
    current: '0xinvited',
    party,
    now: NOW + 1,
  }) // past deadline, still listed
  expect(state.party).toEqual(party) // chain adopted (member reappears)
  expect(state._departed).toBe(null)
  expect(outputs.divergence).toEqual({
    party_id: party.id,
    character_id: '0xinvited',
    predicted: 'departed',
    snapshot: 'present',
  })
})

test('snapshot: a newly joined member resolves (and dismisses) our own pending invite to them (RED-FIRST #2)', () => {
  const leader_view = {
    ...empty_party_state(),
    party_id: party.id,
    _party_character_id: '0xleader',
    party: { id: party.id, leader_character: '0xleader', members: [party.members[0]] }, // solo leader, invite outstanding
    pending_invites: [
      { party_id: party.id, invited_character_id: '0xinvited', invited_name: 'Ares', deadline: NOW + 1 },
    ],
  }
  const { state, outputs } = reduce(leader_view, {
    kind: 'snapshot',
    basis: '0xleader',
    current: '0xleader',
    party, // now lists 0xinvited too — they accepted
    now: NOW,
  })
  expect(outputs.joined).toEqual(['0xinvited'])
  expect(state.pending_invites).toEqual([])
  expect(outputs.pending_invite_requests).toEqual([
    { type: 'dismiss', party_id: party.id, invited_character_id: '0xinvited', reason: 'accepted' },
  ])
})

test('snapshot: an unrelated poll never touches an outstanding pending invite (still within its TTL)', () => {
  const leader_view = {
    ...bound(),
    _party_character_id: '0xleader',
    pending_invites: [{ party_id: party.id, invited_character_id: '0xstranger', invited_name: 'X', deadline: NOW + 1 }],
  }
  const { state, outputs } = reduce(leader_view, {
    kind: 'snapshot',
    basis: '0xleader',
    current: '0xleader',
    party,
    now: NOW,
  })
  expect(state.pending_invites).toEqual(leader_view.pending_invites) // untouched — 0xstranger never joined, not expired
  expect(outputs.pending_invite_requests).toEqual([])
})

test('snapshot TTL sweep: an unanswered pending invite silently expires once its deadline passes (honest fallback #3)', () => {
  const leader_view = {
    ...bound(),
    _party_character_id: '0xleader',
    pending_invites: [{ party_id: party.id, invited_character_id: '0xghosted', invited_name: 'Ghost', deadline: NOW }],
  }
  const { state, outputs } = reduce(leader_view, {
    kind: 'snapshot',
    basis: '0xleader',
    current: '0xleader',
    party, // 0xghosted never appears — declined or just never answered, indistinguishable on-chain
    now: NOW, // deadline reached exactly now
  })
  expect(state.pending_invites).toEqual([])
  expect(outputs.pending_invite_requests).toEqual([
    { type: 'dismiss', party_id: party.id, invited_character_id: '0xghosted', reason: 'expired' },
  ])
})

// ── projection door + shared guard ────────────────────────────────────────────────────────────────────────────────
test('project_party_view yields the renderer-agnostic view both the webapp and the CLI bot consume', () => {
  const view = project_party_view(bound())
  expect(view).toMatchObject({
    party_id: party.id,
    leader_character: '0xleader',
    size: 2,
    is_solo: false,
    capacity_left: 4,
  })
  expect(view.members).toBe(party.members) // stable reference
  expect(project_party_view(empty_party_state()).is_solo).toBe(true)
})

test('is_bound_member requires the basis character AND its live membership', () => {
  expect(is_bound_member(bound(), '0xinvited')).toBe(true)
  expect(is_bound_member(bound(), '0xleader')).toBe(false) // bound to 0xinvited, not the leader
})
