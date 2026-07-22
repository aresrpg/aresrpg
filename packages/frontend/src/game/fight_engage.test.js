// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT ENGAGE ORDERING — committing an attack starts the authoritative submission first, then launches the
// swing as presentation in the same turn. The receipt remains independent of animation completion so its
// consumer can mount the board on the earliest authoritative signal.

import { expect, test } from 'bun:test'

import i18n from '../i18n'
import { use_toast } from '../toast'
import { tx_error } from './core/abort_copy.js'
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

test('intent feedback paints before engage preflight and a refusal replaces it with the reason', async () => {
  use_toast.setState({ toasts: [] })
  const order = []
  const pending = i18n.t('dungeons.tx_pending', { label: i18n.t('fights.action_engage') })
  const refusal = tx_error(
    { MoveAbort: { abortCode: 108, location: { module: 'zones' } } },
    { preflight: true }
  )

  const submitted = start_fight_engage({
    submit: () =>
      use_toast.getState().promise(
        () => {
          const toast = use_toast.getState().toasts.at(-1)
          order.push(toast?.type === 'pending' && toast.message === pending ? 'feedback' : 'feedback:missing')
          order.push('preflight')
          return Promise.reject(refusal)
        },
        { pending }
      ),
    present: () => order.push('swing:start'),
    on_present_error: () => {},
  })

  expect(order).toEqual(['feedback', 'preflight', 'swing:start'])
  await expect(submitted).rejects.toBe(refusal)
  expect(use_toast.getState().toasts.filter((toast) => toast.type === 'pending')).toEqual([])
  expect(use_toast.getState().toasts.filter((toast) => toast.type === 'error')).toMatchObject([
    { message: i18n.t('errors.fight_group_claimed') },
  ])
  use_toast.setState({ toasts: [] })
})
