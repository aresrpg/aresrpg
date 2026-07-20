// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, describe, expect, test } from 'bun:test'

import { use_image_queue, type ImageQueueInput } from './image_queue'

async function wait_for(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition was not reached')
}

describe('image queue finalize worker', () => {
  afterEach(() => {
    use_image_queue.setState({ tasks: {}, panel_collapsed: false })
  })

  test('finalize completion re-enters through the typed input door', async () => {
    let release_finalize!: () => void
    const finalize_done = new Promise<void>((resolve) => {
      release_finalize = resolve
    })
    const task_id = use_image_queue.getState().enqueue({
      label: 'Sword',
      kind: 'ITEM',
      generate: async () => ['data:image/png;base64,ready'],
      finalize: async () => finalize_done,
    })

    await wait_for(() => use_image_queue.getState().tasks[task_id]?.status === 'ready')

    const original_input = use_image_queue.getState().input
    const observed_inputs: ImageQueueInput[] = []
    use_image_queue.setState({
      input: (message) => {
        observed_inputs.push(message)
        original_input(message)
      },
    })
    const original_set_state = use_image_queue.setState
    let async_set_state_calls = 0
    use_image_queue.setState = ((...args: Parameters<typeof original_set_state>) => {
      async_set_state_calls++
      return original_set_state(...args)
    }) as typeof original_set_state

    try {
      use_image_queue.getState().select_variant(task_id, 0)
      release_finalize()
      await wait_for(() => use_image_queue.getState().tasks[task_id] === undefined)

      expect(async_set_state_calls).toBe(0)
      expect(observed_inputs).toEqual([{ type: 'finalize_succeeded', task_id, finalize_attempt: 1 }])

      const settled_state = use_image_queue.getState()
      settled_state.input(observed_inputs[0])
      expect(use_image_queue.getState()).toBe(settled_state)
    } finally {
      use_image_queue.setState = original_set_state
      original_set_state({ input: original_input })
    }
  })

  test('duplicate and late finalize failures cannot corrupt a retry', async () => {
    let reject_first!: (error: Error) => void
    let release_retry!: () => void
    const first_finalize = new Promise<void>((_resolve, reject) => {
      reject_first = reject
    })
    const retry_finalize = new Promise<void>((resolve) => {
      release_retry = resolve
    })
    let finalize_calls = 0
    const task_id = use_image_queue.getState().enqueue({
      label: 'Sword',
      kind: 'ITEM',
      generate: async () => ['data:image/png;base64,ready'],
      finalize: async () => (++finalize_calls === 1 ? first_finalize : retry_finalize),
    })

    try {
      await wait_for(() => use_image_queue.getState().tasks[task_id]?.status === 'ready')
      use_image_queue.getState().select_variant(task_id, 0)
      reject_first(new Error('first save failed'))
      await wait_for(() => use_image_queue.getState().tasks[task_id]?.status === 'error')

      const failed_state = use_image_queue.getState()
      failed_state.input({
        type: 'finalize_failed',
        task_id,
        finalize_attempt: 1,
        error: 'duplicate must not replace the first error',
      })
      expect(use_image_queue.getState()).toBe(failed_state)
      expect(use_image_queue.getState().tasks[task_id]?.error).toBe('first save failed')

      use_image_queue.getState().retry(task_id)
      const retrying_state = use_image_queue.getState()
      retrying_state.input({ type: 'finalize_failed', task_id, finalize_attempt: 1, error: 'late failure' })
      expect(use_image_queue.getState()).toBe(retrying_state)
      expect(use_image_queue.getState().tasks[task_id]?.status).toBe('processing')

      release_retry()
      await wait_for(() => use_image_queue.getState().tasks[task_id] === undefined)
    } finally {
      release_retry()
    }
  })
})
