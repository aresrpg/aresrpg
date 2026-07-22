// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT ENGAGE ORDERING — committing an attack starts the authoritative submission first, then launches the
// swing as presentation in the same turn. The receipt remains independent of animation completion so its
// consumer can mount the board on the earliest authoritative signal.

import { expect, test } from 'bun:test'

import { start_fight_engage } from './fight_engage.js'

test('submit starts before the swing and the receipt can mount the board while presentation is still running', async () => {
  const receipt_gate = Promise.withResolvers()
  const animation_gate = Promise.withResolvers()
  const order = []
  let animation_done = false

  const receipt_pending = start_fight_engage({
    submit: () => {
      order.push('submit')
      return receipt_gate.promise
    },
    present: () => {
      order.push('swing:start')
      void animation_gate.promise.then(() => {
        animation_done = true
        order.push('swing:end')
      })
    },
    on_present_error: () => {},
  })

  expect(order).toEqual(['submit', 'swing:start'])

  receipt_gate.resolve({ fight_id: '0xfight' })
  const receipt = await receipt_pending
  order.push(`board:${receipt.fight_id}`)

  expect(animation_done).toBe(false)
  expect(order).toEqual(['submit', 'swing:start', 'board:0xfight'])

  animation_gate.resolve()
  await animation_gate.promise
  await Promise.resolve()
  expect(order).toEqual(['submit', 'swing:start', 'board:0xfight', 'swing:end'])
})

test('a presentation failure is reported without blocking receipt consumption', async () => {
  const receipt_gate = Promise.withResolvers()
  const presentation_error = new Error('camera listener failed')
  const reported = []
  const order = []

  const receipt_pending = start_fight_engage({
    submit: () => {
      order.push('submit')
      return receipt_gate.promise
    },
    present: () => {
      order.push('swing:start')
      throw presentation_error
    },
    on_present_error: (error) => reported.push(error),
  })

  expect(order).toEqual(['submit', 'swing:start'])
  expect(reported).toEqual([presentation_error])

  receipt_gate.resolve({ fight_id: '0xfight' })
  const receipt = await receipt_pending
  order.push(`board:${receipt.fight_id}`)

  expect(order).toEqual(['submit', 'swing:start', 'board:0xfight'])
})
