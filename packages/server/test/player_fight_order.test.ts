// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { latest_fight_state_reader } from '../src/modules/player_fight.ts'
import { latest_keyed_reader, latest_reader } from '../src/latest_read.ts'

test('a stale fight-state read cannot overwrite a newer checkpoint', async () => {
  const resolvers: ((value: string) => void)[] = []
  const delivered: string[] = []
  const push = latest_fight_state_reader(
    () => new Promise<string>((resolve) => resolvers.push(resolve)),
    (_fight, state) => delivered.push(state)
  )

  const old = push('0xfight')
  const current = push('0xfight')
  resolvers[1]!('post-mob')
  await current
  resolvers[0]!('placement')
  await old

  expect(delivered).toEqual(['post-mob'])
})

test('a stale pre-settlement roster cannot overwrite the returned character HP', async () => {
  const resolvers: ((value: string) => void)[] = []
  const delivered: string[] = []
  const push = latest_keyed_reader(
    () => new Promise<string>((resolve) => resolvers.push(resolve)),
    (_owner, hp) => delivered.push(hp)
  )

  const before_settlement = push('0xowner')
  const after_settlement = push('0xowner')
  resolvers[1]!('1')
  await after_settlement
  resolvers[0]!('55')
  await before_settlement

  expect(delivered).toEqual(['1'])
})

test('a stale singleton social baseline cannot overwrite a newer invalidation', async () => {
  const resolvers: ((value: string) => void)[] = []
  const delivered: string[] = []
  const push = latest_reader(
    () => new Promise<string>((resolve) => resolvers.push(resolve)),
    (value) => delivered.push(value)
  )
  const baseline = push()
  const invalidation = push()
  resolvers[1]!('new')
  await invalidation
  resolvers[0]!('old')
  await baseline
  expect(delivered).toEqual(['new'])
})
