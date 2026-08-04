// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { MSG_MESH_REQUEST } from '../../src/workers/rpc.js'
import { create_worker_pool } from '../../src/workers/pool.js'

describe('worker pool transport', () => {
  test('cross-origin isolation cannot select the false SAB clone path', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated')
    Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true })
    const sent = /** @type {{message: *, transfer: Transferable[]}[]} */ ([])
    /** @type {(event: MessageEvent) => void} */
    let on_message = () => {}
    const worker = {
      /** @param {string} type @param {EventListenerOrEventListenerObject} listener */
      addEventListener(type, listener) {
        if (type === 'message') on_message = /** @type {(event: MessageEvent) => void} */ (listener)
      },
      /** @param {*} message @param {Transferable[]} [transfer] */
      postMessage(message, transfer = []) {
        sent.push({ message, transfer })
        queueMicrotask(() =>
          on_message(
            new MessageEvent('message', {
              data: { type: 'mesh_result', job_id: message.job_id, mode: message.mode, payload: 'ok' },
            })
          )
        )
      },
      terminate() {},
    }
    try {
      const pool = create_worker_pool({
        create_worker: () => /** @type {Worker} */ (/** @type {unknown} */ (worker)),
        worker_count: 1,
      })
      expect('cancel' in pool).toBe(false)
      const bytes = new Uint8Array([1, 2, 3])
      await pool.submit(MSG_MESH_REQUEST, { bytes }, [bytes.buffer])
      expect(sent[0].message.mode).toBe('transfer')
      expect(sent[0].transfer).toEqual([bytes.buffer])
      pool.dispose()
    } finally {
      if (original) Object.defineProperty(globalThis, 'crossOriginIsolated', original)
      else Reflect.deleteProperty(globalThis, 'crossOriginIsolated')
    }
  })
})
