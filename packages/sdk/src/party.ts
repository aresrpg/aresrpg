// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, PartyRow } from '@aresrpg/protocol'

import { receipt_digest } from './cache.ts'
import { SDK } from './client.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'

type GameSdk = ReturnType<typeof SDK>

const custody_of = (character: Readonly<CharacterRow>): KioskCustody => ({
  kiosk: character.kiosk,
  ...(character.kiosk_cap ? { kiosk_cap: character.kiosk_cap } : {}),
})

export const party_actions = (sdk: GameSdk, { kiosk_cap }: Readonly<{ kiosk_cap: KioskCapLoader }>) => {
  const { with_kiosk } = create_kiosk_runner(sdk, kiosk_cap)
  const mutate = async (party: string, actor: CharacterRow, compose: Parameters<typeof with_kiosk>[0]) => {
    await sdk.hydrate_unknown([party])
    const receipt = await with_kiosk(compose, { custody: custody_of(actor) })
    return Object.freeze({ digest: receipt_digest(receipt) })
  }
  const create_invitation = async (actor: CharacterRow, invited: Readonly<{ id: string; name: string }>) => {
    const receipt = await with_kiosk(
      (tx, kiosk, cap) =>
        sdk.doors.create_party_invitation(tx, {
          kiosk,
          cap,
          character_id: actor.id,
          invited_character: invited.id,
        }),
      { custody: custody_of(actor) }
    )
    return Object.freeze({ digest: receipt_digest(receipt) })
  }
  const invite_from_fight = async (
    party: PartyRow | null,
    actor: CharacterRow,
    invited: Readonly<{ id: string; name: string }>
  ) => {
    const active = actor.active_fight
    if (!active) throw new Error('Fight custody has no active fighter identity.')
    if (!party) throw new Error('A new Party can only be created while the character is in kiosk custody.')
    await sdk.hydrate_unknown([party.id, active.id])
    const tx = sdk.tx()
    const shared = {
      f: active.id,
      fighter_idx: active.seat,
      actor_id: actor.id,
      invited_character: invited.id,
    }
    sdk.doors.party_invitation_from_fight(tx, { p: party.id, ...shared })
    const receipt = await sdk.execute(tx, { gas_scope: `fight:${active.id}` })
    return Object.freeze({ digest: receipt_digest(receipt) })
  }
  return Object.freeze({
    invite: async (party: PartyRow | null, actor: CharacterRow, invited: Readonly<{ id: string; name: string }>) => {
      if (actor.custody === 'fight') return invite_from_fight(party, actor, invited)
      if (!party) return create_invitation(actor, invited)
      return mutate(party.id, actor, (tx, kiosk, cap) =>
        sdk.doors.party_invitation(tx, {
          p: party.id,
          kiosk,
          cap,
          actor_id: actor.id,
          invited_character: invited.id,
          present: true,
        })
      )
    },
    accept: (party: string, character: CharacterRow) =>
      mutate(party, character, (tx, kiosk, cap) =>
        sdk.doors.party_accept(tx, { p: party, kiosk, cap, character_id: character.id })
      ),
    decline: (party: string, character: CharacterRow) =>
      mutate(party, character, (tx, kiosk, cap) =>
        sdk.doors.party_invitation(tx, {
          p: party,
          kiosk,
          cap,
          actor_id: character.id,
          invited_character: character.id,
          present: false,
        })
      ),
    rescind: (party: PartyRow, leader: CharacterRow, invited_character: string) =>
      mutate(party.id, leader, (tx, kiosk, cap) =>
        sdk.doors.party_invitation(tx, {
          p: party.id,
          kiosk,
          cap,
          actor_id: leader.id,
          invited_character,
          present: false,
        })
      ),
    leave: (party: PartyRow, character: CharacterRow) =>
      mutate(party.id, character, (tx, kiosk, cap) =>
        sdk.doors.party_leave(tx, { p: party.id, kiosk, cap, character_id: character.id })
      ),
    kick: (party: PartyRow, leader: CharacterRow, target_character: string) =>
      mutate(party.id, leader, (tx, kiosk, cap) =>
        sdk.doors.party_kick(tx, { p: party.id, kiosk, cap, leader_id: leader.id, target_character })
      ),
    disband: (party: PartyRow, leader: CharacterRow) =>
      mutate(party.id, leader, (tx, kiosk, cap) =>
        sdk.doors.party_disband(tx, { p: party.id, kiosk, cap, leader_id: leader.id })
      ),
  })
}

export type PartyActions = ReturnType<typeof party_actions>
