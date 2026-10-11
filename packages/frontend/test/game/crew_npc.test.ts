// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterAppearanceRender, EntityRender, Vec3 } from '@aresrpg/engine'

import { crew } from '../../src/airdrop/crew_campaign.ts'
import { create_crew_npc } from '../../src/game/crew_npc.ts'

test('the crew NPC stays in its authored world and retires its talk prompt with the scene', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const element = {} as HTMLElement
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => element } })
  const frames: (readonly EntityRender[])[] = []
  const labels: (readonly [Readonly<HTMLElement> | null, Vec3 | null])[] = []
  let loads = 0
  const appearance: CharacterAppearanceRender = {
    body_url: 'blast_girl.glb',
    hair_url: null,
    colors: ['#ffffff', '#ffffff', '#ffffff'],
    worn: { head: null, back: null },
  }
  const npc = create_crew_npc({
    submit: (entities) => frames.push(entities),
    caption: () => {},
    ground_height: () => 37,
    set_label: (_id, root, position) => labels.push([root, position]),
    load: async (source) => {
      loads++
      expect(source.classe).toBe(crew.npc.model)
      return appearance
    },
  })
  try {
    npc.set_world('other')
    expect(loads).toBe(0)
    npc.set_world(crew.npc.world)
    await Bun.sleep(0)
    expect(loads).toBe(1)
    expect(frames.at(-1)?.[0]?.anchor).toEqual({ kind: 'world', position: [crew.npc.x, 37, crew.npc.z] })
    npc.update([crew.npc.x, 37, crew.npc.z], true, false)
    expect(labels.at(-1)?.[0]).toBe(element)
    npc.update([crew.npc.x, 37, crew.npc.z], true, true)
    expect(labels.at(-1)?.[0]).toBeNull()
    npc.update([crew.npc.x, 37, crew.npc.z], true, false)
    npc.set_world('other')
    expect(frames.at(-1)).toEqual([])
    expect(labels.at(-1)?.[0]).toBeNull()
    npc.dispose()
    const count = labels.length
    npc.set_world(crew.npc.world)
    npc.update([crew.npc.x, 37, crew.npc.z], true, false)
    expect(labels).toHaveLength(count)
  } finally {
    npc.dispose()
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
