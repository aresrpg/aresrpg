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
  | Readonly<{ type: 'party/accept'; party: string }>
  | Readonly<{ type: 'party/decline'; party: string }>
  | Readonly<{ type: 'party/rescind'; character_id: string }>
  | Readonly<{ type: 'party/leave' }>
  | Readonly<{ type: 'party/kick'; character_id: string }>
  | Readonly<{ type: 'party/follower_moved'; character_id: string; x: number; y: number; z: number }>
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

const declined_party_of = (operation: string | undefined): string | null =>
  operation?.startsWith('decline:') ? operation.slice('decline:'.length) : null

export const selected_party_invitation = (state: Readonly<AppState>): PartyRow | null => {
  const character_id = state.session.selected_character_id ?? ''
  const party = state.party.party_by_character[character_id]
    ? undefined
    : state.party.invitation_ids_by_character[character_id]?.[0]
  const declining = declined_party_of(state.party.pending_by_character[character_id])
  return party && declining !== party ? (state.party.by_id[party] ?? null) : null
}

export const party_invite_allowed = (
  party: Readonly<PartyRow> | null,
  actor: string | null,
  can_create = true
): boolean => {
  if (!actor) return false
  if (!party) return can_create
  return (
    party.members.some(({ character_id }) => character_id === actor) &&
    party.members.length < 6 &&
    party.invited.length < 6
  )
}

const selected_can_create_party = (characters: readonly Readonly<CharacterRow>[], selected: string | null): boolean =>
  characters.some(({ id, custody }) => id === selected && custody === 'kiosk')

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
  const enabled = party_invite_allowed(party, selected, selected_can_create_party(characters, selected))
  const capacity = Math.min(6 - (party?.members.length ?? 1), 6 - (party?.invited.length ?? 0))
  return Object.freeze({ candidates: Object.freeze(candidates.slice(0, Math.max(0, capacity))), enabled, leader })
}

const without_key = <T>(rows: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([id]) => id !== key)))

const pending_after_invites = (
  pending: Readonly<Record<string, string>>,
  character_id: string,
  parties: readonly Readonly<PartyRow>[]
): Readonly<Record<string, string>> => {
  const declining = declined_party_of(pending[character_id])
  return declining && !parties.some(({ id }) => id === declining) ? without_key(pending, character_id) : pending
}

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

type PartyPacket = Extract<AppInput, { type: 'server/packet' }>['packet'] & { type: 'packet/party' }

const memberships_after_party = (
  memberships: Readonly<Record<string, string>>,
  packet: PartyPacket
): Readonly<Record<string, string>> =>
  packet.party
    ? Object.freeze({ ...memberships, [packet.character_id]: packet.party.id })
    : without_key(memberships, packet.character_id)

const parties_after_party = (
  parties: Readonly<Record<string, PartyRow>>,
  packet: PartyPacket
): Readonly<Record<string, PartyRow>> =>
  packet.party ? Object.freeze({ ...parties, [packet.party.id]: packet.party }) : parties

const pending_after_party = (
  pending: Readonly<Record<string, string>>,
  packet: PartyPacket
): Readonly<Record<string, string>> => {
  const operation = pending[packet.character_id]
  return operation && party_operation_reconciled(operation, packet.party)
    ? without_key(pending, packet.character_id)
    : pending
}

const party_has = (
  party: Readonly<PartyRow> | null,
  target: string | undefined,
  field: 'members' | 'invited'
): boolean => !!target && !!party?.[field].some(({ character_id }) => character_id === target)
const party_lacks = (
  party: Readonly<PartyRow> | null,
  target: string | undefined,
  field: 'members' | 'invited'
): boolean => !!party && !!target && !party_has(party, target, field)

const party_operation_reconciled = (operation: string, party: Readonly<PartyRow> | null): boolean => {
  const [kind, target] = operation.split(':')
  switch (kind) {
    case 'leave':
      return party === null
    case 'accept':
      return party?.id === target
    case 'invite':
      return party_has(party, target, 'invited')
    case 'rescind':
      return party_lacks(party, target, 'invited')
    case 'kick':
      return party_lacks(party, target, 'members')
    default:
      return false
  }
}

const fold_party_packet = (state: Readonly<AppState>, packet: PartyPacket): AppState => {
  const party_by_character = memberships_after_party(state.party.party_by_character, packet)
  const by_id = parties_after_party(state.party.by_id, packet)
  const pending_by_character = pending_after_party(state.party.pending_by_character, packet)
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

const fold_party_invites = (
  state: Readonly<AppState>,
  packet: Extract<AppInput, { type: 'server/packet' }>['packet'] & { type: 'packet/party_invites' }
): AppState => {
  const invitation_ids_by_character = Object.freeze({
    ...state.party.invitation_ids_by_character,
    [packet.character_id]: Object.freeze(packet.parties.map(({ id }) => id)),
  })
  const pending_by_character = pending_after_invites(
    state.party.pending_by_character,
    packet.character_id,
    packet.parties
  )
  const by_id = Object.freeze(
    Object.fromEntries([...Object.values(state.party.by_id), ...packet.parties].map((party) => [party.id, party]))
  )
  return Object.freeze({
    ...state,
    party: Object.freeze({
      ...state.party,
      invitation_ids_by_character,
      pending_by_character,
      by_id: retain_referenced(by_id, state.party.party_by_character, invitation_ids_by_character),
    }),
  })
}

const fold_pending = (state: Readonly<AppState>, character_id: string, operation: string | null): AppState =>
  Object.freeze({
    ...state,
    party: Object.freeze({
      ...state.party,
      pending_by_character: operation
        ? Object.freeze({ ...state.party.pending_by_character, [character_id]: operation })
        : without_key(state.party.pending_by_character, character_id),
    }),
  })

const reduce = (state: AppState, input: AppInput): AppState => {
  if (
    input.type === 'auth/disconnected' ||
    input.type === 'auth/rejected' ||
    (input.type === 'auth/connected' && state.session.wallet === input.session)
  )
    return Object.freeze({ ...state, party: initial_party_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/party')
    return fold_party_packet(state, input.packet)
  if (input.type === 'server/packet' && input.packet.type === 'packet/party_invites')
    return fold_party_invites(state, input.packet)
  if (input.type === 'party/pending') return fold_pending(state, input.character_id, input.operation)
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
    const actor = selected_character(state.session)
    const { wallet } = state.session
    if (!actor || !wallet || !party_invite_allowed(selected_party(state), actor.id, actor.custody !== 'fight')) return
    run(
      actor.id,
      `invite:${invited}`,
      wallet,
      async () => {
        const current = selected_party(get_state())
        return wallet.party.invite(current, actor, { id: invited, name })
      },
      true
    )
  })
  const answer = (party_id: string, accept: boolean): void => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const invited = selected_party_invitation(state)?.id === party_id
    if (!character || !wallet || !invited || character.custody !== 'kiosk' || (accept && selected_party(state))) return
    run(
      character.id,
      `${accept ? 'accept' : 'decline'}:${party_id}`,
      wallet,
      () => (accept ? wallet.party.accept(party_id, character) : wallet.party.decline(party_id, character)),
      true
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
      run(leader.id, `rescind:${character_id}`, wallet, () => wallet.party.rescind(party, leader, character_id), true)
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
      run(leader.id, `kick:${character_id}`, wallet, () => wallet.party.kick(party, leader, character_id), true)
  })
}

export default Object.freeze({ name: 'party', reduce, observe }) satisfies AppModule
