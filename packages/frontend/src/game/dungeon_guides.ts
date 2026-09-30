// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  CharacterAppearanceRender,
  CharacterEntityRender,
  DungeonPortalMarker,
  EntityRender,
  WorldCaption,
  Vec3,
} from '@aresrpg/engine'

import source from '../../../../seed/content/adventure.json'

import { npc_caption } from './npc_caption.ts'
import { actor_facing } from './actor_facing.ts'
import { load_character_appearance, world_character_entity } from './character_entities.ts'

export const DUNGEON_GUIDE_LABEL_HEIGHT = 3.4
export const dungeon_guide_id = (id: string): string => `guide:${id}`

/** The tutorial's seed-authored Sceat appearance, composed through the ordinary entity owner. */
export const create_dungeon_guides = ({
  submit,
  caption,
  ground_height,
  load = load_character_appearance,
}: Readonly<{
  submit: (entities: readonly EntityRender[]) => void
  caption: (id: string, value: WorldCaption | null) => void
  ground_height: (x: number, z: number) => number
  load?: typeof load_character_appearance
}>) => {
  let markers: readonly DungeonPortalMarker[] = []
  let appearance: CharacterAppearanceRender | null = null
  let pending: Promise<void> | null = null
  let disposed = false
  let player: Vec3 | undefined
  let entities: readonly CharacterEntityRender[] = []
  const sync = () => {
    if (disposed || !appearance) return
    entities = markers.map(({ id, x, z }) => {
      const previous = entities.find((entity) => entity.id === dungeon_guide_id(id))
      const resting_yaw = previous?.facing.kind === 'yaw' ? previous.facing.yaw : 0
      const position = [x, ground_height(x, z), z] as const
      return world_character_entity(
        { id: dungeon_guide_id(id), appearance: appearance! },
        { position, facing_yaw: actor_facing(position, player, resting_yaw), anim: 'IDLE', gait_scale: 1 }
      )
    })
    submit(entities)
  }
  return {
    face_player: (position: Vec3) => {
      if (disposed || (player?.[0] === position[0] && player?.[2] === position[2])) return
      player = [...position]
      const next = entities.map((entity) => {
        if (entity.anchor.kind !== 'world' || entity.facing.kind !== 'yaw') return entity
        const yaw = actor_facing(entity.anchor.position, player, entity.facing.yaw)
        return yaw === entity.facing.yaw ? entity : { ...entity, facing: { kind: 'yaw' as const, yaw } }
      })
      if (next.every((entity, index) => entity === entities[index])) return
      entities = next
      submit(entities)
    },
    set_markers: (next: readonly DungeonPortalMarker[]) => {
      if (disposed) return
      if (
        markers.length === next.length &&
        markers.every((row, i) => row.id === next[i]?.id && row.x === next[i]?.x && row.z === next[i]?.z)
      )
        return
      const wanted = new Set(next.map(({ id }) => id))
      markers.filter(({ id }) => !wanted.has(id)).forEach(({ id }) => caption(dungeon_guide_id(id), null))
      markers = next
      markers.forEach(({ id }) => caption(dungeon_guide_id(id), npc_caption(source.companion.name)))
      if (markers.length === 0) {
        entities = []
        return submit(entities)
      }
      if (appearance) return sync()
      pending ??= load({
        ...source.companion,
        male: true,
        colors: source.companion.colors as [string, string, string],
      })
        .then((loaded) => {
          appearance = loaded
          sync()
        })
        .catch((error: unknown) => {
          console.error('Dungeon guide appearance could not load.', error)
        })
        .finally(() => {
          pending = null
        })
    },
    speak: (id: string, speech: string | null) => {
      if (disposed || !markers.some((row) => row.id === id)) return
      caption(dungeon_guide_id(id), npc_caption(source.companion.name, speech ?? undefined))
    },
    dispose: () => {
      disposed = true
      markers.forEach(({ id }) => caption(dungeon_guide_id(id), null))
      markers = []
      entities = []
      submit(entities)
    },
  }
}
