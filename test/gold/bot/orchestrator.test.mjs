// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { run_actor_orchestrator } from './orchestrator.mjs'

const actor = (id) => ({
  id,
  wallet: { address: `0x${id}` },
  backend: { id },
  page: null,
  selected_character: { character_id: `${id}-character` },
})

describe('digest-anchored actor orchestration', () => {
  test('a buyer cannot cross a seller barrier until the seller digest committed', async () => {
    const order = []
    let commit_listing
    const listing_committed = new Promise((resolve) => {
      commit_listing = resolve
    })
    const running = run_actor_orchestrator({
      actors: [actor('seller'), actor('buyer')],
      minimum_actors: 2,
      lanes: {
        seller: [{ id: 'listed', do: 'list' }],
        buyer: [{ barrier: { actor: 'seller', step: 'listed' } }, { id: 'bought', do: 'buy' }],
      },
      execute_step: async ({ actor: current, step }) => {
        order.push(`${current.id}:${step.do}:start`)
        if (step.do === 'list') await listing_committed
        order.push(`${current.id}:${step.do}:commit`)
        return { ok: true, digest: `digest-${step.do}` }
      },
    })

    await Promise.resolve()
    expect(order).toEqual(['seller:list:start'])
    commit_listing()
    const result = await running
    expect(order).toEqual(['seller:list:start', 'seller:list:commit', 'buyer:buy:start', 'buyer:buy:commit'])
    expect(result.commits['seller:listed'].digest).toBe('digest-list')
  })

  test('a committed actor step must carry a digest', async () => {
    await expect(
      run_actor_orchestrator({
        actors: [actor('seller'), actor('buyer')],
        minimum_actors: 2,
        lanes: { seller: [{ id: 'listed', do: 'list' }], buyer: [] },
        execute_step: async () => ({ ok: true, digest: null }),
      })
    ).rejects.toThrow('digest')
  })
})
