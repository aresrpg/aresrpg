// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { world_terrain } from '@aresrpg/engine'

import { WorldLoading } from '../../src/components/WorldLoading.tsx'
import { create_world } from '../../src/game/core/world.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initialize_app_store, dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'medium', music_enabled: false, master_volume: 0, render_distance: 3 })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const world = create_world({
  canvas: document.querySelector('canvas')!,
  world: world_terrain('nauvis'),
  quality: 'medium',
  initial_focus: [420, 0],
  render_distance: 3,
})
world.point_at({ x: 420, z: 0 })
world.set_audio_volume(0)
world.set_time_of_day(0.31)
world.set_active(true)
world.set_interactive(true)
createRoot(document.getElementById('root')!).render(<WorldLoading source={world} quality="medium" context="world" />)
window.addEventListener('pagehide', () => world.dispose(), { once: true })
