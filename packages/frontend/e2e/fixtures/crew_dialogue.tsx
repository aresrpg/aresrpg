// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { crew } from '../../src/airdrop/crew_campaign.ts'
import { CrewNpcPrompt } from '../../src/components/CrewNpcPrompt.tsx'
import { GamePageWindow } from '../../src/components/GamePageWindow.tsx'
import { publish_crew_prompt } from '../../src/game/core/crew_prompt_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    read_crew_scene?: () => Readonly<{ settled: boolean; displayed: number; npc_height: number | null }>
  }
}

const copy = await load_app_copy('en')
const show_world = new URLSearchParams(location.search).has('world')
if (show_world) {
  const [{ create_world }, { world_terrain }] = await Promise.all([
    import('../../src/game/core/world.ts'),
    import('../../src/content/worlds.ts'),
  ])
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'
  document.body.append(canvas)
  const world = create_world({
    canvas,
    world: world_terrain('nauvis'),
    quality: 'low',
    render_distance: 32,
    initial_focus: [crew.npc.x, crew.npc.z + 3],
  })
  world.set_audio_volume(0)
  world.set_time_of_day(0.3)
  world.set_crew_world('nauvis')
  world.point_at({ x: crew.npc.x, z: crew.npc.z + 3 })
  world.set_interactive(true)
  world.set_active(true)
  window.read_crew_scene = () => ({
    settled: world.state().render.settled,
    displayed: world.state().displayed_chunks,
    npc_height: world.entity_height('guide:crew:blast_crew'),
  })
  window.addEventListener('pagehide', () => world.dispose(), { once: true })
} else {
  const prompt = document.createElement('div')
  prompt.style.cssText = 'position:fixed;left:50%;top:50%;z-index:1'
  document.body.append(prompt)
  publish_crew_prompt(prompt)
}
dispatch_app({ type: 'page/open', page: 'world' })
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">
    <main className={`min-h-screen font-mono ${show_world ? '' : 'bg-surface-low'}`}>
      <CrewNpcPrompt copy={copy} />
      <GamePageWindow copy={copy} />
    </main>
  </LocaleScope>
)
