// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PresenceRow } from '@aresrpg/protocol'
import type { EntityRender } from '@aresrpg/engine'

import { load_character_appearance, presence_render_source } from '../../src/game/character_entities.ts'
import { create_presence_renderer } from '../../src/game/presence_entities.ts'

// Exercise real catalog/assets while controlling completion order through the renderer's loader seam.
export const run_title_presence_probe = async () => {
  const base: PresenceRow & { y: number } = {
    character_id: 'hero',
    owner: 'owner',
    world: 'nauvis',
    name: 'Hero',
    classe: 'senshi',
    sex: 'male',
    level: 1,
    color_1: 0x112233,
    color_2: 0x445566,
    color_3: 0x778899,
    x: 50_007,
    y: 4,
    z: 50_011,
    riding: false,
    gliding: false,
    pet: null,
    title: 'title_veteran',
    hat: 'ordinary_hat',
    cloak: 'ordinary_cloak',
    cosmetic_hat: 'solomonk',
    cosmetic_cloak: 'cape_fuwa__black',
  }
  const replacement = await load_character_appearance(presence_render_source(JSON.parse(JSON.stringify(base))))
  const reverted = await load_character_appearance(presence_render_source({ ...base, title: null }))
  const frames = new Set<(now: number) => void>()
  const submitted: (readonly EntityRender[])[] = []
  const pending: (() => Promise<void>)[] = []
  const renderer = create_presence_renderer({
    submit: (entities) => submitted.push(entities),
    pet_ground_height: () => 0,
    label: () => {},
    next_frame: (frame) => {
      frames.add(frame)
    },
    appearance_loader: (input) =>
      new Promise((resolve, reject) => {
        pending.push(() => {
          return load_character_appearance(input).then(resolve, reject)
        })
      }),
  })
  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const callbacks = [...frames]
    frames.clear()
    callbacks.forEach((frame) => frame(performance.now() + 16))
  }
  try {
    renderer.update({ hero: { ...base, title: null } }, null)
    await pending.shift()!()
    await flush()
    renderer.update({ hero: base }, null)
    const title_loads = pending.length
    await pending.shift()!()
    await flush()
    const selected = submitted.at(-1)?.[0]
    renderer.update({ hero: { ...base, title: null } }, null)
    await pending.shift()!()
    await flush()
    const latest = submitted.at(-1)?.[0]

    // A title load completing after unequip must never restore the replacement.
    renderer.update({ hero: base }, null)
    renderer.update({ hero: { ...base, title: null } }, null)
    await pending.pop()!()
    await flush()
    await pending.pop()!()
    await flush()
    const final = submitted.at(-1)?.[0]
    return { title_loads, replacement, reverted, selected, latest, final }
  } finally {
    renderer.dispose()
  }
}
