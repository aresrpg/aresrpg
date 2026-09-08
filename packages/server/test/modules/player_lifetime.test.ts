// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_player } from '../../src/player.ts'
import { wire } from '../helpers/stream_wire.ts'

test('closing during presence subscription prevents late who and appear publication', async () => {
  const h = wire()
  let release!: () => void
  const registration = new Promise<void>((resolve) => {
    release = resolve
  })
  const publications: unknown[] = []
  const pubsub = {
    ...h.pubsub,
    mesh: {
      ...h.pubsub.mesh,
      subscribe: () => registration,
      publish: async (_channel: string, payload: unknown) => {
        publications.push(payload)
      },
    },
  }
  const player = create_player({ ws: h.ws, graph: h.graph, pubsub, address: '0xme', admin: false })
  await Bun.sleep(0)
  player.on_close()
  const at_close = publications.length
  release()
  await Bun.sleep(0)
  expect(publications).toHaveLength(at_close)
  expect(pubsub.mesh.emitter.eventNames()).toEqual([])
  expect(pubsub.graph.emitter.eventNames()).toEqual([])
})
