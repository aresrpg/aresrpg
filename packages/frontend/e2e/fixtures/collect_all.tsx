// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { job_xp_for_level } from '@aresrpg/immutable'

import type { AuthSession } from '../../src/auth.ts'
import { SpawnNametag } from '../../src/components/SpawnNametag.tsx'
import { BackgroundGatherProgress, GatherProgress } from '../../src/game/hud/GatherProgress.tsx'
import { publish_spawn_tag } from '../../src/game/core/nametag_feed.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { resource_node_id } from '../../src/game/resource_nodes.ts'
import { resource_pack_id } from '../../src/modules/world_spawns.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, observe_app, read_app_state, useAppStore } from '../../src/store.ts'
import { character, initialize_automation_app, key, resource, tick } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

const level = Number(new URLSearchParams(location.search).get('level') ?? 30)
const controlled = { ...character(), jobs: { [resource.job]: String(job_xp_for_level(level)) } }
let gathers = 0
const wallet = {
  address: 'owner',
  character: {
    gather: () => {
      gathers++
      return new Promise(() => {})
    },
  },
} as unknown as AuthSession
initialize_automation_app({ dispatch: dispatch_app }, wallet, controlled)
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
observe_app(['world', 'automation'])
publish_pose(tick().pose)
publish_spawn_tag(resource_node_id(resource_pack_id(key, '1', 0), 0), document.getElementById('tag'))
Reflect.set(window, 'collect_all_page', () => dispatch_app({ type: 'page/open', page: 'marketplace' }))
Reflect.set(window, 'collect_all_state', () => ({ gathers, run: read_app_state().automation.run }))
const Fixture = () => {
  const world_page = useAppStore((state) => state.navigation.page === 'world')
  return (
    <>
      <input aria-label="Chat" className="m-4 bg-white" />
      {world_page && (
        <>
          <SpawnNametag copy={copy} />
          <GatherProgress copy={copy} position="world" />
        </>
      )}
      <BackgroundGatherProgress copy={copy} />
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
