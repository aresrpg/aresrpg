// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { BiomeMusic } from '../../src/game/audio/BiomeMusic.tsx'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { pages } from '../../src/modules/navigation.ts'
import { dispatch_app, read_app_state, useAppStore } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    music_events: string[]
    music_players: HTMLMediaElement[]
  }
}

dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: 'owner' } as AuthSession })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character()] } })
dispatch_app({ type: 'character/select', character_id: 'alice' })
publish_pose({ character_id: 'alice', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0 })

const settings = (changes: Partial<ReturnType<typeof read_app_state>['settings']>): void =>
  dispatch_app({ type: 'settings/changed', settings: { ...read_app_state().settings, ...changes } })

const Fixture = () => {
  const page = useAppStore((state) => state.navigation.page)
  return (
    <main className="min-h-screen bg-bg p-6 text-white" data-current-page={page}>
      <BiomeMusic />
      <nav className="flex flex-wrap gap-4">
        {pages
          .filter((value) => value !== 'admin')
          .map((value) => (
            <button key={value} onClick={() => dispatch_app({ type: 'page/open', page: value })}>
              {value}
            </button>
          ))}
      </nav>
      <button onClick={() => settings({ music_enabled: false })}>Disable music</button>
      <button onClick={() => settings({ music_enabled: true })}>Enable music</button>
      <button onClick={() => settings({ master_volume: 0 })}>Mute volume</button>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
