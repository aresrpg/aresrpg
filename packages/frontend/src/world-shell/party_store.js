// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Party driver EDGE (composition root): the pure state machine lives in @aresrpg/party; this shell reads ambient
// identity (selected character, wallet address, owned roster), builds inputs, DISPATCHES them into the ONE reducer,
// and executes the reducer's effect requests — self-paid party PTBs (party_actions), room chat scope,
// room presence, the /v1
// poll, join toasts, divergence logs. No async result ever set()s domain state directly (ONE-PIPELINE law); the
// edge-local tx-phase flags (busy/error — not reconcile state) re-enter through the ONE `_tx_phase` door, and the
// timer handle stays inside the polling doors, so every await continuation writes via a store action. Accepted rosters
// stay exact character-keyed Member[] (never an address slot); signed on-chain accept/decline owns consent.

import { useStore } from 'zustand'
import { create_party_store } from '@aresrpg/party/store'
import { is_bound_member, has_character, party_invite_verdict, POLL_MS } from '@aresrpg/party/reduce'

import i18n from '../i18n'
import { context } from '../game/store.js'
import { use_auth } from '../auth'
import { use_toast } from '../toast'
import { get_party } from '../chain/read_party'
import { publish_room_state, set_room_party } from '../p2p/lobby-room.js'
import { push_event_toast } from '../game/core/toast.js'
import { humanize_abort } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'

import { read_dungeon_session, subscribe_dungeon_session } from './dungeon_session.js'
import {
  create_party as tx_create_party,
  join_owned_alts_to_party,
  invite_to_party,
  accept_party_invite,
  decline_party_invite,
  kick_from_party,
  leave_party as tx_leave_party,
  disband_party as tx_disband_party,
} from './party_actions'
import {
  fold_pending_invite,
  latch_declined_invite,
  read_pending_invites,
  reset_declined_invites,
} from './party_invite_carrier.js'
import { select_owned_party_join_ids } from './team_entry.js'
import { error_executed_digest } from './tx_digest_error.js'
import { resolve_character_docs, resolve_character_name, short_fighter_id } from './character_name_resolve.js'

const selected_character_id = () => context.get_state().selected_character_id ?? null
const selected_character = () => {
  const state = context.get_state()
  return state.sui?.characters?.find((/** @type {any} */ character) => character.id === state.selected_character_id)
}
const owned_join_ids = (party, address, blocked_ids = []) => {
  const leader = selected_character()
  const blocked = new Set(blocked_ids)
  return select_owned_party_join_ids({
    owned_characters: (context.get_state().sui?.characters ?? []).map((character) => ({
      ...character,
      owner: address,
      world: character.world_id ?? null,
      blocked_reason: blocked.has(character.id) ? 'executed_failure' : character.blocked_reason,
    })),
    party_members: party?.members,
    my_address: address,
    active_character_id: leader?.id ?? null,
    active_world_id: leader?.world_id ?? null,
  })
}
const has_blocked_owned_join = (party, blocked_ids) => {
  const leader = selected_character()
  const roster = context.get_state().sui?.characters ?? []
  return (blocked_ids ?? []).some((character_id) => {
    const character = roster.find((row) => row.id === character_id)
    return character?.world_id === leader?.world_id && !has_character(party, character_id)
  })
}

/** OWNED-character display names from the local roster, synchronous — feeds the per-alt toast label (#328). */
const owned_names_by_id = (/** @type {string[]} */ character_ids) =>
  Object.fromEntries(
    character_ids.map((id) => [id, (context.get_state().sui?.characters ?? []).find((c) => c.id === id)?.name ?? null])
  )

// THE party atom is the package's vanilla store — created once here, with the edge-owned tx-phase
// flags riding the same atom. Methods are edge closures injected onto the atom right below (consumers
// select them exactly as before); `fold_party` is the package's ONE domain write door.
const { store: party_store, dispatch: fold_party } = create_party_store({
  busy: false,
  /** @type {string | null} */
  error: null,
  /** @type {ReturnType<typeof setInterval> | null} */
  _poll_timer: null,
  /** @type {Map<string, number>} party_id:invited_character_id → the live use_toast id (edge-only; the reducer
   *  itself only ever sees the domain pair, never a toast id — CLIENT-INDEPENDENCE law). */
  _pending_invite_toast_ids: new Map(),
})
const get = () => party_store.getState()

party_store.setState({
  /** Fold one input through the package's write door, then execute its effect requests at the edge. */
  _dispatch(input) {
    const outputs = fold_party(input)
    if (outputs.divergence)
      game_log(
        'party',
        'membership divergence — predicted a departure the chain still lists (adopting chain)',
        outputs.divergence
      )
    for (const character_id of outputs.joined) void get()._announce_member_joined(character_id)
    for (const request of outputs.pending_invite_requests) get()._handle_pending_invite_request(request)
    if (outputs.stale_reread) void get().refresh()
    if (outputs.publish) get()._publish_state()
    return outputs
  },

  /** "X joined the party" via the ONE character_name_resolve home (#328 — never a raw address slice). */
  async _announce_member_joined(character_id) {
    const docs = await resolve_character_docs([character_id])
    const name = docs.get(character_id)?.name || short_fighter_id(character_id)
    push_event_toast({ state: 'success', title: i18n.t('party.member_joined_toast', { name }) })
  },

  /** Turn one reducer toast request into the real use_toast call — see header (the OUTGOING pending-invite
   *  toast: invitee name + a cancel action, until accept/refuse/expiry). The numeric toast id is edge-only
   *  bookkeeping the pure reducer never sees, keyed by the same domain pair the reducer already tracks, so a
   *  re-armed request for an already-visible toast never opens a second one and a dismiss always finds its toast. */
  _handle_pending_invite_request(request) {
    const key = `${request.party_id}:${request.invited_character_id}`
    const ids = get()._pending_invite_toast_ids
    if (request.type === 'dismiss') {
      const toast_id = ids.get(key)
      if (toast_id != null) use_toast.getState().remove(toast_id)
      ids.delete(key)
      return
    }
    if (ids.has(key)) return // already open — never double-open for the same domain pair
    const toast_id = use_toast
      .getState()
      .add_persistent(
        i18n.t('party.invite_awaiting_toast', { name: request.invited_name || i18n.t('party.adventurer') }),
        'pending',
        { label: i18n.t('party.cancel_invite_cta'), onClick: () => get().cancel_invite(request.invited_character_id) }
      )
    ids.set(key, toast_id)
  },

  /** The ONE writer of the edge tx-phase flags (busy/error — local flags, never reconcile state). A sync door:
   *  every await continuation re-enters through a store action, never a direct `set` (CODE_LAW L-P4). */
  _tx_phase(patch) {
    party_store.setState(patch)
  },

  /** Sign one bare party create for the selected character and bind its receipt (NO owned auto-join). Public —
   *  the cold-start "invite one other player" seam (PlayerActionMenu.jsx) calls this directly: #329, that flow
   *  used to cold-start through create() below, which unconditionally sweeps every owned alt into the party as
   *  real, accepted, on-chain members. A deliberate multichar squad stays the explicit picker's job
   *  (invite_owned, PartyFrame.jsx) or the system's own silent ensure_owned_party() — never a side effect of
   *  inviting a stranger. */
  async create_bare({ silent = false } = {}) {
    const character_id = selected_character_id()
    if (!character_id) return null
    const { party_id } = await tx_create_party(character_id, { silent })
    if (!party_id) throw new Error('create_party did not return a party id')
    const { address } = use_auth.getState()
    get()._dispatch({ kind: 'receipt_patch', action: 'create', party_id, character_id, address })
    get()._start_polling()
    return { party_id, character_id, address }
  },

  /** Create a party for the selected character. `silent` runs the create quietly (system auto-form); the
   *  human's explicit create keeps its visible toast. */
  async create({ silent = false } = {}) {
    if (get().busy) return
    const character_id = selected_character_id()
    if (!character_id) return
    get()._clear_character_mismatch(character_id)
    get()._tx_phase({ busy: true, error: null })
    try {
      const created = await get().create_bare({ silent })
      if (!created) throw new Error('create_party did not return a party id')
      const { party_id, address } = created
      const invited_character_ids = owned_join_ids(get().party, address, get()._owned_join_blocked_ids)
      if (invited_character_ids.length) {
        await join_owned_alts_to_party({
          party_id,
          leader_character_id: character_id,
          invited_character_ids,
          invited_names: owned_names_by_id(invited_character_ids),
          on_joined: (joined_character_id) =>
            get()._dispatch({ kind: 'receipt_patch', action: 'join', character_id: joined_character_id, address }),
        })
      } else await get().refresh()
    } catch (error) {
      const blocked_character_id = error?.owned_character_id
      if (blocked_character_id && error_executed_digest(error))
        get()._dispatch({ kind: 'intent', action: 'block_owned_join', character_id: blocked_character_id })
      game_log('party', 'create failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** PICKER door: invite EXACTLY the chosen owned alts (creating the party first when solo). Unlike the
   *  auto path (join_owned), no eligibility sweep widens the set — the human's pick is the set; the group
   *  loop then aligns worlds for any picked alt standing elsewhere. */
  async invite_owned(character_ids) {
    const chosen = [...new Set((character_ids ?? []).filter(Boolean))]
    const leader_character_id = selected_character_id()
    const { address } = use_auth.getState()
    if (get().busy || !chosen.length || !leader_character_id || !address) return false
    get()._clear_character_mismatch(leader_character_id)
    get()._tx_phase({ busy: true, error: null })
    try {
      if (!get().party_id) {
        const created = await get().create_bare()
        if (!created) throw new Error('create_party did not return a party id')
      }
      await join_owned_alts_to_party({
        party_id: get().party_id,
        leader_character_id,
        invited_character_ids: chosen,
        invited_names: owned_names_by_id(chosen),
        on_joined: (joined_character_id) =>
          get()._dispatch({ kind: 'receipt_patch', action: 'join', character_id: joined_character_id, address }),
      })
      await get().refresh()
      return true
    } catch (error) {
      const blocked_character_id = error?.owned_character_id
      if (blocked_character_id && error_executed_digest(error))
        get()._dispatch({ kind: 'intent', action: 'block_owned_join', character_id: blocked_character_id })
      game_log('party', 'owned invite (picker) failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
      return false
    } finally {
      get()._tx_phase({ busy: false })
    }
  },

  async join_owned() {
    const { party_id, party, busy } = get()
    const leader_character_id = selected_character_id()
    const { address } = use_auth.getState()
    if (busy || !party_id || !party || !leader_character_id || !address) return false
    const invited_character_ids = owned_join_ids(party, address, get()._owned_join_blocked_ids)
    if (!invited_character_ids.length) return !has_blocked_owned_join(party, get()._owned_join_blocked_ids)
    if (party.leader_character !== leader_character_id || !is_bound_member(get(), leader_character_id)) return false
    get()._tx_phase({ busy: true, error: null })
    try {
      await join_owned_alts_to_party({
        party_id,
        leader_character_id,
        invited_character_ids,
        invited_names: owned_names_by_id(invited_character_ids),
        on_joined: (joined_character_id) =>
          get()._dispatch({ kind: 'receipt_patch', action: 'join', character_id: joined_character_id, address }),
      })
      return true
    } catch (error) {
      const blocked_character_id = error?.owned_character_id
      if (blocked_character_id && error_executed_digest(error))
        get()._dispatch({ kind: 'intent', action: 'block_owned_join', character_id: blocked_character_id })
      game_log('party', 'owned-character join failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
      return false
    } finally {
      get()._tx_phase({ busy: false })
    }
  },

  async ensure_owned_party() {
    const { address } = use_auth.getState()
    const leader = selected_character()
    if (!address || !leader) return false
    if (get().party_id) return get().join_owned()
    const synthetic = {
      id: '',
      leader_character: leader.id,
      members: [{ character: leader.id, owner: address, order: 0 }],
    }
    if (!owned_join_ids(synthetic, address, get()._owned_join_blocked_ids).length)
      return !has_blocked_owned_join(synthetic, get()._owned_join_blocked_ids)
    await get().create({ silent: true }) // system entry (combat auto-form) → quiet create, no toast
    return !!get().party_id && !has_blocked_owned_join(get().party, get()._owned_join_blocked_ids)
  },

  /** The selected leader character invites one exact character (caps at six). Arms the persistent "waiting for
   *  a reply" toast once the tx lands. `invited_name` is the caller's already-resolved name (#328, e.g.
   *  PlayerActionMenu's `target.name`) — falls back to the network resolve only when absent. */
  async invite(invited_character_id, invited_owner, invited_name = null) {
    const { party_id, busy, pending_invites } = get()
    const leader_character_id = selected_character_id()
    if (busy || !party_id || !leader_character_id || !invited_character_id || !invited_owner) return
    // Already awaiting a reply from this exact character — re-firing would just die on-chain (EAlreadyInvited).
    if (pending_invites.some((invite) => invite.invited_character_id === invited_character_id)) return
    if (get()._clear_character_mismatch(leader_character_id) || !is_bound_member(get(), leader_character_id)) {
      void get().refresh()
      return
    }
    const verdict = party_invite_verdict(get(), leader_character_id)
    if (verdict === 'not_leader') return
    if (verdict === 'full') {
      get()._tx_phase({ error: i18n.t('errors.party_full') })
      return
    }
    get()._tx_phase({ busy: true, error: null })
    try {
      const resolved_name = invited_name || (await resolve_character_name(invited_character_id))
      await invite_to_party(party_id, leader_character_id, invited_character_id, invited_owner, resolved_name)
      get()._dispatch({
        kind: 'intent',
        action: 'invite_sent',
        party_id,
        invited_character_id,
        invited_name: resolved_name,
        now: Date.now(),
      })
    } catch (error) {
      game_log('party', 'invite failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Local-only cancel of OUR OWN "waiting for a reply" toast — party.move exposes no leader-side revoke (see
   *  @aresrpg/party's reduce.js header), so the invite itself stays recorded on-chain; never a PTB. */
  cancel_invite(invited_character_id) {
    const { party_id } = get()
    if (!party_id) return
    get()._dispatch({ kind: 'intent', action: 'cancel_invite', party_id, invited_character_id })
    use_toast.getState().add(i18n.t('party.invite_cancel_notice'), 'info')
  },

  /** Accept is the invited character's own signed party transaction. */
  async accept_invite() {
    const invite = get().incoming_invite
    if (!invite || get().busy) return
    if (selected_character_id() !== invite.invited_character_id) {
      get()._dispatch({ kind: 'intent', action: 'decline', character_id: selected_character_id() })
      return
    }
    get()._tx_phase({ busy: true, error: null })
    try {
      await accept_party_invite(invite.party_id, invite.invited_character_id)
      game_log('party', `invite accepted for ${invite.invited_character_id.slice(0, 10)}`)
      await get().adopt_party_id(invite.party_id, invite.invited_character_id)
    } catch (error) {
      game_log('party', 'accept failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Decline is also signed by the exact pending character; it removes intent without creating membership. */
  async decline_invite() {
    const invite = get().incoming_invite
    if (!invite || get().busy) return
    if (selected_character_id() !== invite.invited_character_id) {
      get()._dispatch({ kind: 'intent', action: 'decline', character_id: selected_character_id() })
      return
    }
    get()._tx_phase({ busy: true, error: null })
    try {
      await decline_party_invite(invite.party_id, invite.invited_character_id)
      // Latch the refusal until the authoritative read agrees — see party_invite_carrier.js.
      latch_declined_invite(invite.party_id, invite.invited_character_id)
      get()._dispatch({ kind: 'intent', action: 'decline', character_id: invite.invited_character_id })
      game_log('party', `invite declined for ${invite.invited_character_id.slice(0, 10)}`)
    } catch (error) {
      game_log('party', 'decline failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Leader-only removal of one exact accepted character. */
  async kick(target_character_id) {
    const { party_id, busy } = get()
    const leader_character_id = selected_character_id()
    if (busy || !party_id || !leader_character_id) return
    if (get()._clear_character_mismatch(leader_character_id) || !is_bound_member(get(), leader_character_id)) {
      void get().refresh()
      return
    }
    if (get().party.leader_character !== leader_character_id) return
    get()._tx_phase({ busy: true, error: null })
    try {
      await kick_from_party(party_id, leader_character_id, target_character_id)
      get()._dispatch({ kind: 'receipt_patch', action: 'kick', party_id, target_character_id, now: Date.now() })
      await get().refresh()
    } catch (error) {
      game_log('party', 'kick failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Leave by selected character; if it led a multi-character party, Move elects the oldest survivor. */
  async leave() {
    const { party_id, busy } = get()
    const character_id = selected_character_id()
    if (busy || !party_id || !character_id) return
    if (get()._clear_character_mismatch(character_id) || !is_bound_member(get(), character_id)) {
      void get().refresh()
      return
    }
    get()._tx_phase({ busy: true, error: null })
    try {
      await tx_leave_party(party_id, character_id)
      get()._dispatch({ kind: 'receipt_patch', action: 'leave', party_id, character_id, now: Date.now() })
    } catch (error) {
      game_log('party', 'leave failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Delete a solo party. */
  async disband() {
    const { party_id, busy } = get()
    const leader_character_id = selected_character_id()
    if (busy || !party_id || !leader_character_id) return
    if (get()._clear_character_mismatch(leader_character_id) || !is_bound_member(get(), leader_character_id)) {
      void get().refresh()
      return
    }
    if (get().party.leader_character !== leader_character_id || get().party.members.length !== 1) return
    get()._tx_phase({ busy: true, error: null })
    try {
      await tx_disband_party(party_id, leader_character_id)
      get()._dispatch({ kind: 'receipt_patch', action: 'disband' })
    } catch (error) {
      game_log('party', 'disband failed', error)
      get()._tx_phase({ error: humanize_abort(error) })
    }
    get()._tx_phase({ busy: false })
  },

  /** Reconcile the selected character through GET /v1/parties?character= — the snapshot input source. The pending
   *  invitations ride the SAME tick (#2008): one poll, two dimensions of the same character-keyed read, no second
   *  clock. The pending read is fenced off on its own so a read-layer hiccup there never costs the membership
   *  snapshot the whole party UI depends on. */
  async refresh() {
    const character_id = selected_character_id()
    if (!character_id) return
    get()._clear_character_mismatch(character_id)
    try {
      const party = await get_party(character_id)
      // A read started for A must never bind its result after the user switches to B while it is in flight — the
      // reducer's basis fence discards it (current !== basis) and asks for a re-read.
      get()._dispatch({
        kind: 'snapshot',
        basis: character_id,
        current: selected_character_id(),
        party,
        now: Date.now(),
      })
      if (get().party) get()._tx_phase({ error: null })
      await get()._fold_pending_invites(character_id)
    } catch (error) {
      game_log('party', 'refresh failed', error)
    }
  },

  /** Hand the carrier the poll's pending rows plus the doors it needs — the store owns identity and the reducer
   *  door; party_invite_carrier.js owns which row is honest to deliver. */
  async _fold_pending_invites(basis_character_id) {
    const invites = await read_pending_invites(basis_character_id)
    if (!invites) return
    await fold_pending_invite(invites, basis_character_id, {
      party_id: get().party_id,
      incoming_invite: get().incoming_invite,
      is_selected: () => selected_character_id() === basis_character_id,
      dispatch: (input) => get()._dispatch(input),
    })
  },

  /** Adopt the id only after this exact character's accept transaction succeeds. */
  async adopt_party_id(party_id, character_id) {
    get()._dispatch({ kind: 'receipt_patch', action: 'accept', party_id, character_id })
    get()._start_polling()
    await get().refresh()
  },

  set_incoming_dungeon(dungeon_id, template_id) {
    get()._dispatch({ kind: 'event', event: 'dungeon_share', dungeon_id, template_id })
  },

  clear_incoming_dungeon() {
    get()._dispatch({ kind: 'event', event: 'clear_dungeon' })
  },

  _start_polling() {
    get()._stop_polling()
    const timer = setInterval(() => get().refresh(), POLL_MS)
    party_store.setState({ _poll_timer: timer })
  },

  _stop_polling() {
    const timer = get()._poll_timer
    if (timer) clearInterval(timer)
    party_store.setState({ _poll_timer: null })
  },

  /** Drop A's cached party synchronously when B becomes active; the next projection read may then bind B. */
  _clear_character_mismatch(character_id) {
    const { incoming_invite, _party_character_id: bound_character_id } = get()
    const drop_invite = !!incoming_invite && incoming_invite.invited_character_id !== character_id
    const mismatched = !!bound_character_id && bound_character_id !== character_id
    if (mismatched) set_room_party(null)
    if (drop_invite || mismatched)
      get()._dispatch({ kind: 'intent', action: 'switch_basis', to_character_id: character_id })
    return mismatched
  },

  reset_local() {
    get()._stop_polling()
    set_room_party(null)
    reset_declined_invites()
    // Drop any toast still tracked for the OLD session — an uncleared entry would leak a "waiting…" toast that
    // nothing left in this store can ever resolve (no matching pending_invites row survives the reset below).
    const ids = get()._pending_invite_toast_ids
    for (const toast_id of ids.values()) use_toast.getState().remove(toast_id)
    ids.clear()
    party_store.setState({
      party_id: null,
      party: null,
      incoming_dungeon_id: null,
      incoming_template_id: null,
      incoming_invite: null,
      pending_invites: [],
      busy: false,
      error: null,
      _awaiting_party_id: null,
      _awaiting_character_id: null,
      _party_character_id: null,
    })
    if (wired) get()._start_polling()
  },

  /** Publish the selected character's low-frequency identity + exact party id to both transition scopes. */
  _publish_state(character_override = null) {
    const character = character_override ?? selected_character()
    const character_id = character?.id ?? selected_character_id()
    if (character_id) get()._clear_character_mismatch(character_id)
    const awaiting_this_character =
      get()._party_character_id === character_id &&
      get()._awaiting_character_id === character_id &&
      get()._awaiting_party_id === get().party_id
    const published_party_id =
      character_id && (is_bound_member(get(), character_id) || awaiting_this_character) ? get().party_id : null
    set_room_party(published_party_id)
    const { address } = use_auth.getState()
    if (!address) return
    if (!character?.classe)
      game_log(
        'p2p',
        'state published WITHOUT identity (roster/selection not ready) — peers render the fallback rig until the next publish'
      )
    publish_room_state({
      address,
      color_1: character?.color_1 ?? 0,
      color_2: character?.color_2 ?? 0,
      color_3: character?.color_3 ?? 0,
      party_id: published_party_id,
      dungeon_id: read_dungeon_session().dungeon_id,
      classe: character?.classe ?? null,
      male: character?.male ?? true,
      name: character?.name ?? null,
    })
  },
})

/** Thin React binding over the package's vanilla store — the ONE party atom (methods ride the atom). */
export const use_party = Object.assign(
  (/** @type {(state: any) => any} */ selector) => useStore(party_store, selector),
  { getState: party_store.getState, setState: party_store.setState, subscribe: party_store.subscribe }
)

let wired = false

/** Start the character-keyed party projection reads once per session. */
export function wire_party_reads() {
  if (wired) {
    use_party.getState()._start_polling()
    void use_party.getState().refresh()
    return
  }
  wired = true
  // Character-keyed projection makes accepted membership recoverable after reload; poll even while solo.
  use_party.getState()._start_polling()
  void use_party.getState().refresh()
  // Instance scope is room presence, too: entry/exit republishes only on a real dungeon-id transition.
  subscribe_dungeon_session((session, previous) => {
    if (session.dungeon_id !== previous?.dungeon_id) use_party.getState()._publish_state()
  })
}
