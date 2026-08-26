// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { party_actions } from '../src/party.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`
const character = (value: number, name: string) =>
  ({ id: id(value), name, kiosk: id(value + 20), kiosk_cap: id(value + 30) }) as CharacterRow

test('party creation projects identity; later mutations return certified completion only', async () => {
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
          effects: {
            changedObjects: [{ objectId: party_id, idOperation: 'Created' }],
          },
          objectTypes: { [party_id]: `${id(1)}::party::Party` },
        },
      }
    },
    doors: {
      create_party: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'create', args }),
      party_invitation: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'invitation', args }),
      party_accept: (_tx: unknown, args: Record<string, unknown>) => calls.push({ door: 'accept', args }),
    },
  }
  const actions = party_actions(sdk as never, { kiosk_cap: async () => null })
  const leader = character(1, 'Ari')
  const invited = character(2, 'Bex')
  const created = await actions.create(leader)
  const certified = await actions.invite(created.party, leader, { id: invited.id, name: invited.name })
  await actions.accept(created.party.id, invited)

  expect(created.party.members).toEqual([{ character_id: leader.id, name: 'Ari' }])
  expect(execute_options[0]).toEqual({
    custody: { kiosk: leader.kiosk, kiosk_cap: leader.kiosk_cap },
    include: { objectTypes: true },
  })
  expect(certified).toEqual({ digest: 'digest' })
  expect(calls.map(({ door }) => door)).toEqual(['create', 'invitation', 'accept'])
  expect(calls[1]?.args).toMatchObject({ actor_id: leader.id, invited_character: invited.id, present: true })
})
