// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Nearby players rendered in the world: folds the presence slice (PresenceRow by character id)
// into the world scene's external-entity door. Appearances load once per identity change; live
// positions ride packet/player_moved through the store. A row with a pet is MOUNTED by
// definition (the presence contract) — the pet renders under a seated rider.

import type { CharacterAnimationName, EntityRender } from '@aresrpg/engine'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import type { PresenceRow } from '@aresrpg/protocol'

import { load_character_appearance, presence_render_source, world_character_entity } from './character_entities.ts'
import { pet_locomotion_of, pet_seat_height, type PetLocomotion } from './core/pet_locomotion.ts'

/** A stopped player stops emitting moves — after this quiet window the run pose relaxes. */
const IDLE_AFTER_MS = 300

type LoadedPresence = {
  appearance: Awaited<ReturnType<typeof load_character_appearance>>
  pet: Readonly<{ model_url: string; locomotion: PetLocomotion }> | null
}

type PresenceSlot = {
  source_key: string
  loaded: LoadedPresence | null
  x: number
  y: number
  z: number
  yaw: number
  moved_at: number
}

export const create_presence_renderer = ({
  submit,
  entity_height,
}: Readonly<{
  submit: (entities: readonly EntityRender[]) => void
  entity_height: (id: string) => number | null
}>) => {
  const slots = new Map<string, PresenceSlot>()
  const generations = new Map<string, number>()
  let idle_timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const build = (): void => {
    if (disposed) return
    const now = Date.now()
    const entities = [...slots.entries()].flatMap(([character_id, slot]): EntityRender[] => {
      if (!slot.loaded) return []
      const moving = now - slot.moved_at < IDLE_AFTER_MS
      const mounted = slot.loaded.pet !== null
      const pet_id = `${character_id}:pet`
      const rider_y = mounted ? slot.y + pet_seat_height(entity_height(pet_id)) : slot.y
      const anim: CharacterAnimationName = mounted ? 'SIT' : moving ? 'RUN' : 'IDLE'
      const character = world_character_entity(
        Object.freeze({ id: character_id, appearance: slot.loaded.appearance }),
        Object.freeze({
          position: Object.freeze([slot.x, rider_y, slot.z] as const),
          facing_yaw: slot.yaw,
          anim,
          gait_scale: 1,
        })
      )
      if (!slot.loaded.pet) return [character]
      return [
        character,
        Object.freeze({
          id: pet_id,
          kind: 'mob' as const,
          model_url: slot.loaded.pet.model_url,
          anchor: Object.freeze({ kind: 'world' as const, position: Object.freeze([slot.x, slot.y, slot.z] as const) }),
          facing: Object.freeze({ kind: 'yaw' as const, yaw: slot.yaw }),
          animation: Object.freeze({ name: moving ? ('RUN' as const) : ('IDLE' as const), time_scale: 1 }),
        }),
      ]
    })
    submit(Object.freeze(entities))
    const any_moving = [...slots.values()].some((slot) => slot.loaded && now - slot.moved_at < IDLE_AFTER_MS)
    if (idle_timer) clearTimeout(idle_timer)
    // one deferred rebuild relaxes run→idle once the last mover's quiet window elapses
    idle_timer = any_moving ? setTimeout(build, IDLE_AFTER_MS + 50) : null
  }

  const load = (character_id: string, row: Readonly<PresenceRow>, source_key: string): void => {
    const generation = (generations.get(character_id) ?? 0) + 1
    generations.set(character_id, generation)
    const pet_type = row.pet
    // content modules stay dynamic — pet_models uses Vite's import.meta.glob, a build-only door
    const load_pet = async (): Promise<LoadedPresence['pet']> => {
      if (!pet_type) return null
      const [{ load_pet_model_url }, { content_catalog }] = await Promise.all([
        import('../content/pet_models.ts'),
        import('../content/catalog.ts'),
      ])
      const model_url = await load_pet_model_url(pet_type)
      const item = content_catalog.item(pet_type)?.item
      return model_url && item ? Object.freeze({ model_url, locomotion: pet_locomotion_of(item) }) : null
    }
    void Promise.all([load_character_appearance(presence_render_source(row)), load_pet()])
      .then(([appearance, pet]) => {
        const slot = slots.get(character_id)
        if (disposed || !slot || slot.source_key !== source_key || generations.get(character_id) !== generation) return
        slot.loaded = { appearance, pet }
        build()
      })
      .catch((error: unknown) => console.error(`Nearby player ${character_id} failed to load its appearance.`, error))
  }

  return Object.freeze({
    update: (rows: Readonly<Record<string, PresenceRow>>, own_character_id: string | null): void => {
      if (disposed) return
      const now = Date.now()
      let changed = false
      for (const stale of [...slots.keys()].filter((id) => !(id in rows) || id === own_character_id)) {
        slots.delete(stale)
        generations.delete(stale)
        changed = true
      }
      for (const [character_id, row] of Object.entries(rows)) {
        if (character_id === own_character_id) continue
        const source_key = [row.classe, row.sex, row.color_1, row.color_2, row.color_3, row.hat, row.cloak, row.pet]
          .map(String)
          .join('|')
        // presence rides the wire in chain space — the scene lives in client coordinates
        const x = chain_to_client_coordinate(row.x)
        const z = chain_to_client_coordinate(row.z)
        const slot = slots.get(character_id)
        if (!slot || slot.source_key !== source_key) {
          slots.set(character_id, {
            source_key,
            loaded: null,
            x,
            y: row.y,
            z,
            yaw: slot?.yaw ?? 0,
            moved_at: 0,
          })
          load(character_id, row, source_key)
          changed = true
          continue
        }
        const dx = x - slot.x
        const dz = z - slot.z
        if (dx !== 0 || dz !== 0 || row.y !== slot.y) {
          slot.yaw = dx * dx + dz * dz > 0.000_1 ? Math.atan2(dx, dz) : slot.yaw
          slot.x = x
          slot.y = row.y
          slot.z = z
          slot.moved_at = now
          changed = true
        }
      }
      if (changed) build()
    },
    dispose: (): void => {
      disposed = true
      if (idle_timer) clearTimeout(idle_timer)
      slots.clear()
      generations.clear()
      submit(Object.freeze([]))
    },
  })
}
