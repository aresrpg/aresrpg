// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import type { AuthSession } from '../../src/auth.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { resource_node_id } from '../../src/game/resource_nodes.ts'
import { resource_pack_id } from '../../src/modules/world_spawns.ts'
import { create_app } from '../../src/store.ts'

import { automation_fixture, character, initialize_automation_app, key, resource, tick } from './automation_fixture.ts'

test('Collect All sends one PTB per confirmed eligible node and stops on its protector', async () => {
  const app = create_app()
  const base = automation_fixture()
  const controlled = { ...character(), jobs: { [resource.job]: String(job_xp_for_level(30)) } }
  let gathers = 0
  let resolves = 0
  let finish!: (result: { quantity: number; ambushed: boolean }) => void
  const wallet = {
    address: 'owner',
    character: {
      gather: () => {
        gathers++
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      resolve_ambush: async () => {
        resolves++
        return { fight: 'protector' }
      },
    },
  } as unknown as AuthSession
  initialize_automation_app(app, wallet, controlled)
  publish_pose(tick().pose)
  const close = app.observe(['world', 'automation'])
  try {
    app.dispatch({
      type: 'automation/collect_all',
      id: 'pack',
      node: resource_node_id(resource_pack_id(key, '1', 0), 0),
      pose: tick().pose,
    })
    expect(gathers).toBe(1)
    app.dispatch({ type: 'page/open', page: 'marketplace' })
    expect(app.store.getState().automation.run).not.toBeNull()
    const deadline = Date.now() + 10_000
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/characters', characters: [{ ...controlled, at_ms: deadline }] },
    })
    app.dispatch({
      type: 'server/packet',
      packet: { type: 'packet/zones', zones: [{ ...base.world.zones[key]!, res_taken: [1] }] },
    })
    expect(gathers).toBe(1)
    finish({ quantity: 2, ambushed: false })
    await Bun.sleep(0)
    expect(gathers).toBe(1)
    const gathering = app.store.getState().world.gathering.alice!
    // Even an early UI completion cannot bypass the observed chain checkpoint deadline.
    app.dispatch({
      type: 'world/gather_finished',
      character_id: 'alice',
      attempt_id: gathering.attempt_id,
      ends_at_ms: gathering.ends_at_ms,
    })
    expect(gathers).toBe(1)
    app.dispatch({ type: 'clock/observed', chain_ms: deadline + 1, received_ms: performance.now() })
    expect(gathers).toBe(2)
    finish({ quantity: 2, ambushed: true })
    await Bun.sleep(0)
    expect(app.store.getState().automation.run).toBeNull()
    expect(resolves).toBe(1)
    app.dispatch({ type: 'clock/observed', chain_ms: deadline + 20_000, received_ms: performance.now() })
    expect(gathers).toBe(2)
  } finally {
    close()
    publish_pose(null)
  }
})
