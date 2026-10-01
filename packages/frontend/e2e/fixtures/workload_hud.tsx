// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { world_terrain } from '@aresrpg/engine'
import { createRoot } from 'react-dom/client'

import { load_crowd } from '../../src/demo/CharacterCrowdLab.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { Minimap } from '../../src/game/hud/Minimap.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app } from '../../src/store.ts'
import { create_frame_waiter, wait_for_frame_condition } from '../support/frame_waiter.ts'

import { workload_equipped } from './workload_population.tsx'
import { measure_scene } from './workload_solo.ts'

export const run_hud_workload = async (moving = false) => {
  const recipe = world_terrain('nauvis')
  const world = create_world({
    canvas: document.querySelector('canvas')!,
    world: recipe,
    quality: 'high',
    initial_focus: [420, 0],
    initial_yaw: Math.PI / 2,
  })
  const hud = document.createElement('div')
  hud.style.cssText = 'position:fixed;top:0;right:0;width:288px;z-index:10'
  document.body.append(hud)
  const root = createRoot(hud)
  world.point_at({ x: 420, z: 0 })
  world.set_audio_volume(0)
  world.set_time_of_day(0.31)
  world.set_active(true)
  world.set_interactive(true)
  const advance = async (stage: string) => {
    if (moving) {
      world.point_at({ x: 420, z: 0 })
      await create_frame_waiter({})(120)
      return measure_scene(world, stage, 18, true)
    }
    let previous = performance.now()
    return measure_scene(world, stage, 12, false, () => {
      const now = performance.now()
      world.follow_camera().rotate(((now - previous) * Math.PI * 2) / (12_000 * 0.0025), 0)
      previous = now
    })
  }
  try {
    await create_frame_waiter({})(120)
    await wait_for_frame_condition(() => world.state().render.settled && !world.state().chunks.in_flight)
    const [actor] = await workload_equipped(await load_crowd(1, world.ground_height))
    world.set_character(actor!)
    await wait_for_frame_condition(() => world.entity_height(actor!.id) !== null)
    await create_frame_waiter({})(120)
    const standing = await measure_scene(world, 'idle-no-hud', 5, false)
    const motion = moving ? 'forward' : 'orbit'
    const cold = await advance(`${motion}-no-hud-cold`)
    const warm = await advance(`${motion}-no-hud-warm`)
    const copy = await load_app_copy('en')
    dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
    root.render(
      <LocaleScope locale="en">
        <Minimap copy={copy} terrain={recipe} />
      </LocaleScope>
    )
    await create_frame_waiter({})(120)
    const with_hud = await advance(`${motion}-with-minimap`)
    root.render(null)
    await create_frame_waiter({})(120)
    const restored = await advance(`${motion}-no-hud-restored`)
    return { standing, cold, warm, with_hud, restored, backend: world.backend() }
  } finally {
    window.workload_on_frame = undefined
    root.unmount()
    hud.remove()
    world.dispose()
  }
}

declare global {
  interface Window {
    run_hud_workload: typeof run_hud_workload
  }
}
