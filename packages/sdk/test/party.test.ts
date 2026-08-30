// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { party_actions } from '../src/party.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const character = (value: number, name: string) =>
  ({ id: id(value), name, kiosk: id(value + 20), kiosk_cap: id(value + 30) }) as CharacterRow

const cap_of = (row: CharacterRow) => ({
  objectId: row.kiosk_cap!,
  kioskId: row.kiosk,
  isPersonal: true,
  version: '1',
  digest,
})

const fighting_character = (value: number, name: string, fight: number, seat: number) =>
  ({
    ...character(value, name),
    custody: 'fight',
    active_fight: { id: id(fight), seat },
  }) as CharacterRow

test('every kiosk invitation returns certified completion without projecting Party state', async () => {
  const calls: { door: string; args: Record<string, unknown> }[] = []
  const execute_options: unknown[] = []
  const party_id = id(90)
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) =>
      compose(id(40), id(41)),
    execute: async (_transaction: unknown, options: unknown) => {
      execute_options.push(options)
      return {
        Transaction: {
          digest: 'digest',
        },
      }
    },
    doors: {
      create_party_invitation: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'create', args }),
      party_invitation: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'invitation', args }),
      party_accept: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'accept', args }),
    },
  }
  const leader = character(1, 'Ari')
  const invited = character(2, 'Bex')
  const caps = [leader, invited].map(cap_of)
  const actions = party_actions(sdk as never, {
    kiosk_cap: async (kiosk) => caps.find(({ kioskId }) => kioskId === kiosk) ?? null,
  })
  const created = await actions.invite(null, leader, { id: invited.id, name: invited.name })
  const party = {
    id: party_id,
    members: [{ character_id: leader.id, name: leader.name }],
    invited: [{ character_id: invited.id, name: invited.name }],
  }
  const certified = await actions.invite(party, leader, { id: id(3), name: 'Cyr' })
  await actions.accept(party.id, invited)

  expect(created).toEqual({ digest: 'digest' })
  expect(certified).toEqual({ digest: 'digest' })
  expect(execute_options[0]).toEqual({ custody: { kiosk: leader.kiosk, kiosk_cap: leader.kiosk_cap } })
  expect(calls.map(({ door }) => door)).toEqual(['create', 'invitation', 'accept'])
  expect(calls[0]?.args).toMatchObject({ character_id: leader.id, invited_character: invited.id })
  expect(calls[1]?.args).toMatchObject({ actor_id: leader.id, invited_character: id(3), present: true })
})

test('fight custody invites through the controlled fighter without borrowing the kiosk', async () => {
  const calls: { door: string; args: Record<string, unknown> }[] = []
  const hydrated: string[][] = []
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async (ids: string[]) => hydrated.push(ids),
    execute: async () => ({ Transaction: { digest: 'fight-invite' } }),
    doors: {
      party_invitation_from_fight: (_tx: unknown, args: Record<string, unknown>) =>
        calls.push({ door: 'fight_invitation', args }),
    },
  }
  const actions = party_actions(sdk as never, { kiosk_cap: async () => null })
  const actor = fighting_character(2, 'Bex', 80, 1)
  const party = {
    id: id(90),
    members: [
      { character_id: id(1), name: 'Ari' },
      { character_id: actor.id, name: actor.name },
    ],
    invited: [],
  }

  const receipt = await actions.invite(party, actor, { id: id(3), name: 'Cyr' })

  expect(receipt).toEqual({ digest: 'fight-invite' })
  expect(hydrated).toEqual([[party.id, actor.active_fight!.id]])
  expect(calls).toEqual([
    {
      door: 'fight_invitation',
      args: {
        p: party.id,
        f: actor.active_fight!.id,
        fighter_idx: 1,
        actor_id: actor.id,
        invited_character: id(3),
      },
    },
  ])
})
