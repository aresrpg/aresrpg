// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import type { ChatLine } from '../../src/modules/chat.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

const line = (id: string): ChatLine =>
  Object.freeze({ id, channel: 'combat' as const, key: 'log_lost', values: Object.freeze({}) })

const settings = Object.freeze({
  quality: 'medium' as const,
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

test('the chat appends capped history and corrects only through the replaces door', () => {
  const base = initial_app_state(settings)
  const with_line = reduce_app_state(base, { type: 'chat/line', line: line('a') })
  expect(with_line.chat.lines.map(({ id }) => id)).toEqual(['a'])

  // the correction door rewrites in place, keeping the addressed id
  const corrected = reduce_app_state(with_line, {
    type: 'chat/line',
    line: Object.freeze({ ...line('ignored'), key: 'log_lost_reduced' }),
    replaces: 'a',
  })
  expect(corrected.chat.lines).toHaveLength(1)
  expect(corrected.chat.lines[0]).toMatchObject({ id: 'a', key: 'log_lost_reduced' })

  // a correction addressing a vanished line writes nothing
  const orphan = reduce_app_state(with_line, { type: 'chat/line', line: line('b'), replaces: 'gone' })
  expect(orphan).toBe(with_line)

  // history caps at 100
  const flooded = Array.from({ length: 130 }, (_, index) => index).reduce(
    (state, index) => reduce_app_state(state, { type: 'chat/line', line: line(`n${index}`) }),
    base
  )
  expect(flooded.chat.lines).toHaveLength(100)
  expect(flooded.chat.lines[0]!.id).toBe('n30')
})
