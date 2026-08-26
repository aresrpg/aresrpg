// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, PartyRow } from '@aresrpg/protocol'
import type { AuthSession } from '@aresrpg/sdk/auth'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { selected_character } from './session.ts'

export type PartyState = Readonly<{
  by_id: Readonly<Record<string, PartyRow>>
  party_by_character: Readonly<Record<string, string>>
  invitation_ids_by_character: Readonly<Record<string, readonly string[]>>
  pending_by_character: Readonly<Record<string, string>>
}>

export type PartyInput =
  | Readonly<{ type: 'party/invite'; character_id: string; name: string }>
  | Readonly<{ type: 'party/invite_owned'; character_id: string }>
  | Readonly<{ type: 'party/accept'; party: string }>
  | Readonly<{ type: 'party/decline'; party: string }>
  | Readonly<{ type: 'party/rescind'; character_id: string }>
  | Readonly<{ type: 'party/leave' }>
  | Readonly<{ type: 'party/kick'; character_id: string }>
  | Readonly<{ type: 'party/pending'; character_id: string; operation: string | null }>

export const initial_party_state = (): PartyState =>
  Object.freeze({
    by_id: Object.freeze({}),
    party_by_character: Object.freeze({}),
    invitation_ids_by_character: Object.freeze({}),
    pending_by_character: Object.freeze({}),
  })

export const selected_party = (state: Readonly<AppState>): PartyRow | null => {
  const character_id = state.session.selected_character_id
  const party = character_id ? state.party.party_by_character[character_id] : undefined
  return party ? (state.party.by_id[party] ?? null) : null
}

export const selected_party_invitation = (state: Readonly<AppState>): PartyRow | null => {
  const character_id = state.session.selected_character_id
  const party = character_id ? state.party.invitation_ids_by_character[character_id]?.[0] : undefined
  return party ? (state.party.by_id[party] ?? null) : null
}

export const owned_party_invite_view = (
  characters: readonly Readonly<CharacterRow>[],
  selected: string | null,
  memberships: Readonly<Record<string, string>>,
  party: Readonly<PartyRow> | null
) => {
  const leader = party?.members[0]?.character_id ?? null
  const members = new Set(party?.members.map(({ character_id }) => character_id) ?? [])
  const invited = new Set(party?.invited.map(({ character_id }) => character_id) ?? [])
  const candidates = characters.filter(
    ({ id, custody }) =>
      id !== selected && custody === 'kiosk' && !memberships[id] && !members.has(id) && !invited.has(id)
  )
  const enabled =
    !!selected &&
    (!party || leader === selected) &&
    (party?.members.length ?? 1) < 6 &&
    (party?.invited.length ?? 0) < 6
  const capacity = Math.min(6 - (party?.members.length ?? 1), 6 - (party?.invited.length ?? 0))
  return Object.freeze({ candidates: Object.freeze(candidates.slice(0, Math.max(0, capacity))), enabled, leader })
}

const without_key = <T>(rows: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([id]) => id !== key)))

const retain_referenced = (
  by_id: Readonly<Record<string, PartyRow>>,
  party_by_character: Readonly<Record<string, string>>,
  invitation_ids_by_character: Readonly<Record<string, readonly string[]>>
): Readonly<Record<string, PartyRow>> => {
  const referenced = new Set([
    ...Object.values(party_by_character),
    ...Object.values(invitation_ids_by_character).flat(),
  ])
  return Object.freeze(Object.fromEntries(Object.entries(by_id).filter(([id]) => referenced.has(id))))
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (
    input.type === 'auth/disconnected' ||
    input.type === 'auth/rejected' ||
    (input.type === 'auth/connected' && state.session.wallet === input.session)
  )
    return Object.freeze({ ...state, party: initial_party_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/party') {
    const party_by_character = input.packet.party
      ? Object.freeze({ ...state.party.party_by_character, [input.packet.character_id]: input.packet.party.id })
      : without_key(state.party.party_by_character, input.packet.character_id)
    const by_id = input.packet.party
      ? Object.freeze({ ...state.party.by_id, [input.packet.party.id]: input.packet.party })
      : state.party.by_id
    const pending_by_character =
      !input.packet.party && state.party.pending_by_character[input.packet.character_id] === 'leave'
        ? without_key(state.party.pending_by_character, input.packet.character_id)
        : state.party.pending_by_character
    return Object.freeze({
      ...state,
      party: Object.freeze({
        ...state.party,
        party_by_character,
        pending_by_character,
        by_id: retain_referenced(by_id, party_by_character, state.party.invitation_ids_by_character),
      }),
    })
  }
  if (input.type === 'server/packet' && input.packet.type === 'packet/party_invites') {
    const invitation_ids_by_character = Object.freeze({
      ...state.party.invitation_ids_by_character,
      [input.packet.character_id]: Object.freeze(input.packet.parties.map(({ id }) => id)),
    })
    const by_id = Object.freeze(
      Object.fromEntries(
        [...Object.values(state.party.by_id), ...input.packet.parties].map((party) => [party.id, party])
      )
    )
    return Object.freeze({
      ...state,
      party: Object.freeze({
        ...state.party,
        invitation_ids_by_character,
        by_id: retain_referenced(by_id, state.party.party_by_character, invitation_ids_by_character),
      }),
    })
  }
  if (input.type === 'party/pending')
    return Object.freeze({
      ...state,
      party: Object.freeze({
        ...state.party,
        pending_by_character: input.operation
          ? Object.freeze({ ...state.party.pending_by_character, [input.character_id]: input.operation })
          : without_key(state.party.pending_by_character, input.character_id),
      }),
    })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const run = (
    character_id: string,
    operation: string,
    wallet: AuthSession,
    action: () => Promise<Readonly<{ digest: string }>>,
    hold_success = false
  ): void => {
    if (get_state().party.pending_by_character[character_id]) return
    dispatch({ type: 'party/pending', character_id, operation })
    let succeeded = false
    void action()
      .then(() => {
        succeeded = true
      })
      .catch((error) => {
        if (get_state().session.wallet === wallet) toast.add(error)
      })
      .finally(() => {
        const state = get_state()
        if (succeeded && hold_success) return
        if (state.session.wallet === wallet && state.party.pending_by_character[character_id] === operation)
          dispatch({ type: 'party/pending', character_id, operation: null })
      })
  }
  events.on('party/invite', ({ character_id: invited, name }) => {
    const state = get_state()
    const leader = selected_character(state.session)
    const { wallet } = state.session
    if (!leader || !wallet) return
    run(leader.id, `invite:${invited}`, wallet, async () => {
      const current = selected_party(get_state())
      const created = current ? null : await wallet.party.create(leader)
      if (get_state().session.wallet !== wallet) return created!
      const party = current ?? created!.party
      return wallet.party.invite(party, leader, { id: invited, name })
    })
  })
  events.on('party/invite_owned', ({ character_id: invited }) => {
    const state = get_state()
    const leader = selected_character(state.session)
    const target = state.session.characters.find(({ id }) => id === invited)
    const { wallet } = state.session
    if (!leader || !target || !wallet || target.custody !== 'kiosk' || state.party.party_by_character[target.id]) return
    run(leader.id, `invite_owned:${invited}`, wallet, async () => {
      const current = selected_party(get_state())
      const created = current ? null : await wallet.party.create(leader)
      if (get_state().session.wallet !== wallet) return created!
      const party = current ?? created!.party
      const invited_receipt = await wallet.party.invite(party, leader, { id: target.id, name: target.name })
      if (get_state().session.wallet !== wallet) return invited_receipt
      return wallet.party.accept(party.id, target)
    })
  })
  const answer = (party_id: string, accept: boolean): void => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const invited = selected_party_invitation(state)?.id === party_id
    if (!character || !wallet || !invited || character.custody !== 'kiosk' || (accept && selected_party(state))) return
    run(character.id, `${accept ? 'accept' : 'decline'}:${party_id}`, wallet, () =>
      accept ? wallet.party.accept(party_id, character) : wallet.party.decline(party_id, character)
    )
  }
  events.on('party/accept', ({ party }) => answer(party, true))
  events.on('party/decline', ({ party }) => answer(party, false))
  events.on('party/rescind', ({ character_id }) => {
    const state = get_state()
    const leader = selected_character(state.session)
    const { wallet } = state.session
    const party = selected_party(state)
    if (leader && wallet && party)
      run(leader.id, `rescind:${character_id}`, wallet, () => wallet.party.rescind(party, leader, character_id))
  })
  events.on('party/leave', () => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const party = selected_party(state)
    if (!character || !wallet || !party) return
    run(
      character.id,
      'leave',
      wallet,
      () =>
        party.members.length === 1 ? wallet.party.disband(party, character) : wallet.party.leave(party, character),
      true
    )
  })
  events.on('party/kick', ({ character_id }) => {
    const state = get_state()
    const leader = selected_character(state.session)
    const { wallet } = state.session
    const party = selected_party(state)
    if (leader && wallet && party)
      run(leader.id, `kick:${character_id}`, wallet, () => wallet.party.kick(party, leader, character_id))
  })
}

export default Object.freeze({ name: 'party', reduce, observe }) satisfies AppModule
