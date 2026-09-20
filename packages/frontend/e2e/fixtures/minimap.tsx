// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { Minimap } from '../../src/game/hud/Minimap.tsx'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import type { AuthSession } from '../../src/auth.ts'
import { character, initialize_automation_app } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

initialize_automation_app({ dispatch: dispatch_app }, { address: 'owner' } as AuthSession)
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const zone = (zx: number, consumed = 0, world = 'nauvis') => ({
  world,
  zx,
  zz: 97,
  seed: '1',
  searched_at_ms: 1,
  mob_taken: '0',
  res_taken: [consumed],
})
const populate = (world: string): void => {
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [{ ...character(), world, checkpoint_world: world }] },
  })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/tracked_zones',
      character_id: 'alice',
      world,
      zones: [
        { zx: 97, zz: 97 },
        { zx: 98, zz: 97 },
      ],
    },
  })
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/zones', zones: [zone(97, 0, world), zone(98, 0, world)] },
  })
  for (const [zx, x] of [
    [97, 50120],
    [98, 50220],
  ] as const)
    dispatch_app({
      type: 'server/packet',
      packet: {
        type: 'packet/zone_spawns',
        world,
        zx,
        zz: 97,
        mobs: [],
        resources: [{ index: 0, x, z: 50040, item_type: 'wheat', nodes: 1 }],
      },
    })
}
populate('nauvis')
const root = createRoot(document.getElementById('root')!)
const move = (x: number) => {
  publish_pose(null)
  publish_pose({ character_id: 'alice', x, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0.3 })
}
Reflect.set(window, 'minimap_fixture', {
  travel: () => populate('yakutia'),
  remount: () => root.render(<Minimap key="fresh" copy={copy} />),
  move,
  consume: () => dispatch_app({ type: 'server/packet', packet: { type: 'packet/zones', zones: [zone(98, 1)] } }),
})
move(160)
root.render(<Minimap copy={copy} />)
