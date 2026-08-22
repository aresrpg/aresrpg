// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { latest_fight_state_reader } from '../src/modules/player_fight.ts'

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
