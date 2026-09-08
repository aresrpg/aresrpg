// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { character_actions } from '../src/character_actions.ts'

const harness = (failure?: Error) => {
  const calls: unknown[] = []
  const requested: unknown[] = []
  let executions = 0
  const cap = { objectId: 'personal', kioskId: 'source', version: '1', digest: 'cap', isPersonal: true }
  const sdk = {
    tx: () => ({}),
    with_owner_kiosk: (_tx: unknown, owner_cap: unknown, compose: (kiosk: string, cap: unknown) => void) => {
      expect(owner_cap).toEqual(cap)
      compose('source', 'borrowed-cap')
    },
    doors: { delete_character: (_tx: unknown, args: unknown) => calls.push(args) },
    execute: async () => {
      executions += 1
      if (failure) throw failure
      return { Transaction: { digest: 'deleted' } }
    },
  }
  const actions = character_actions(sdk as never, {
    kiosk_cap: async (kiosk) => {
      requested.push(kiosk)
      return cap
    },
  })
  return { actions, calls, requested, executions: () => executions }
}

test('deletes the requested character through its exact personal kiosk custody', async () => {
  const h = harness()
  expect(
    await h.actions.delete({ character_id: 'character', custody: { kiosk: 'source', kiosk_cap: 'personal' } })
  ).toEqual({ digest: 'deleted' })
  expect(h.requested).toEqual(['source'])
  expect(h.calls).toEqual([{ kiosk: 'source', cap: 'borrowed-cap', character_id: 'character' }])
  expect(h.executions()).toBe(1)
})

test('refuses another kiosk before submitting', async () => {
  const h = harness()
  await expect(h.actions.delete({ character_id: 'character', custody: { kiosk: 'foreign' } })).rejects.toThrow(
    'unavailable'
  )
  expect(h.executions()).toBe(0)
})

test('an executed Move refusal never causes an automatic deletion retry', async () => {
  const failure = new Error('Executed transaction failed: EDeleteWhileEquipped')
  const h = harness(failure)
  await expect(h.actions.delete({ character_id: 'character', custody: { kiosk: 'source' } })).rejects.toBe(failure)
  expect(h.executions()).toBe(1)
})
