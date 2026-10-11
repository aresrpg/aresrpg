// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Vec3 } from '@aresrpg/engine'

import { crew } from '../airdrop/crew_campaign.ts'

import { create_npc_guides } from './npc_guides.ts'
import { publish_crew_prompt } from './core/crew_prompt_feed.ts'

/** A scene actor and talk prompt only. Gift collection remains the existing airdrop page. */
export const create_crew_npc = ({
  set_label,
  ...options
}: Parameters<typeof create_npc_guides>[0] &
  Readonly<{
    set_label: (id: string, element: Readonly<HTMLElement> | null, position: Vec3 | null) => void
  }>) => {
  const root = typeof document === 'undefined' ? null : document.createElement('div')
  const id = `crew:${crew.campaign}`
  const guide = create_npc_guides({
    ...options,
    character_source: {
      id,
      name: crew.npc.name,
      classe: crew.npc.model,
      male: false,
      colors: ['#ffffff', '#ffffff', '#ffffff'],
      loadout: {},
    },
  })
  let active = false
  let visible = false
  let disposed = false
  const show = (next: boolean) => {
    if (visible === next) return
    visible = next
    const position: Vec3 = [crew.npc.x, options.ground_height(crew.npc.x, crew.npc.z) + 2.5, crew.npc.z]
    set_label(id, next ? root : null, next ? position : null)
    publish_crew_prompt(next ? root : null)
  }
  return {
    hide: () => show(false),
    set_world: (world: string | null) => {
      const next = world === crew.npc.world
      if (disposed || next === active) return
      active = next
      guide.set_markers(active ? [{ id, x: crew.npc.x, z: crew.npc.z }] : [])
      show(false)
    },
    update: (position: Vec3, enabled: boolean, locked: boolean) => {
      if (disposed) return
      guide.face_player(position)
      show(active && enabled && !locked && Math.hypot(position[0] - crew.npc.x, position[2] - crew.npc.z) <= 4)
    },
    dispose: () => {
      disposed = true
      show(false)
      guide.dispose()
    },
  }
}
