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
import { pet_locomotion_of, pet_seat_height, pet_vertical_offset, type PetLocomotion } from './core/pet_locomotion.ts'
import { empty_pet_motion, step_pet_follow, type PetMotion } from './core/pet_follow.ts'
import { read_pose } from './core/pose_feed.ts'

/** A stopped player stops emitting moves — after this quiet window the run pose relaxes. */
const IDLE_AFTER_MS = 300
/** Legacy-tuned interpolation: the shown position converges to the network target over 0.1s. */
const MOVE_LERP_SECONDS = 0.1
/** Under this remaining distance the lerp snaps and the tick loop rests (legacy 0.01). */
const SNAP_DISTANCE = 0.01
/** Past this range a player's mixer freezes on the idle pose — animation costs nothing far away. */
const ANIMATION_RANGE_BLOCKS = 100

// bun's test runtime has no requestAnimationFrame — a timer keeps the module loadable there
const raf: (callback: (now: number) => void) => void =
  typeof globalThis.requestAnimationFrame === 'function'
    ? (callback) => globalThis.requestAnimationFrame(callback)
    : (callback) => void setTimeout(() => callback(performance.now()), 16)

type LoadedPresence = {
  appearance: Awaited<ReturnType<typeof load_character_appearance>>
  pet: Readonly<{ model_url: string; locomotion: PetLocomotion }> | null
}

type PresenceSlot = {
  source_key: string
  loaded: LoadedPresence | null
  /** shown position — converges toward the target each frame */
  x: number
  y: number
  z: number
  /** network target — the last packet's truth */
  tx: number
  ty: number
  tz: number
  yaw: number
  moved_at: number
  /** actually mounted (the wire's riding flag) — an unridden pet FOLLOWS on foot instead */
  riding: boolean
  /** the follower's own local walk — the same pure sim the own pet runs */
  pet_motion: PetMotion
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
  let ticking = false
  let last_tick_ms = 0

  /** rAF loop that runs only while a shown position still chases its target. */
  const tick = (now: number): void => {
    if (disposed) return
    const delta_seconds = Math.min((now - last_tick_ms) / 1000, 0.25)
    last_tick_ms = now
    const factor = Math.min(delta_seconds / MOVE_LERP_SECONDS, 1)
    let converging = false
    for (const slot of slots.values()) {
      const dx = slot.tx - slot.x
      const dy = slot.ty - slot.y
      const dz = slot.tz - slot.z
      if (dx === 0 && dy === 0 && dz === 0) continue
      if (Math.hypot(dx, dy, dz) < SNAP_DISTANCE) {
        slot.x = slot.tx
        slot.y = slot.ty
        slot.z = slot.tz
      } else {
        slot.x += dx * factor
        slot.y += dy * factor
        slot.z += dz * factor
        converging = true
      }
    }
    // unridden pets walk their own leash beside their owner — the loop stays awake until
    // every follower has settled (arrivals and mount toggles wake it through wake_tick)
    for (const slot of slots.values()) {
      if (!slot.loaded?.pet || slot.riding) continue
      const spawning = !Number.isFinite(slot.pet_motion.x)
      slot.pet_motion = step_pet_follow(slot.pet_motion, { x: slot.x, z: slot.z }, delta_seconds)
      converging ||= slot.pet_motion.moving || spawning
    }
    build()
    ticking = converging
    if (converging) raf(tick)
  }

  const wake_tick = (): void => {
    if (ticking || disposed) return
    ticking = true
    last_tick_ms = performance.now()
    raf(tick)
  }

  const build = (): void => {
    if (disposed) return
    const now = Date.now()
    const own = read_pose()
    const entities = [...slots.entries()].flatMap(([character_id, slot]): EntityRender[] => {
      if (!slot.loaded) return []
      // beyond animation range the mixer freezes on the idle pose (never a T-pose: IDLE still applies)
      const far = own ? Math.hypot(slot.x - own.x, slot.z - own.z) > ANIMATION_RANGE_BLOCKS : false
      const moving = !far && now - slot.moved_at < IDLE_AFTER_MS
      const mounted = slot.riding && slot.loaded.pet !== null
      const pet_id = `${character_id}:pet`
      const rider_y = mounted ? slot.y + pet_seat_height(entity_height(pet_id)) : slot.y
      const anim: CharacterAnimationName = far ? 'IDLE' : mounted ? 'SIT' : moving ? 'RUN' : 'IDLE'
      const time_scale = far ? 0 : 1
      const character = world_character_entity(
        Object.freeze({ id: character_id, appearance: slot.loaded.appearance }),
        Object.freeze({
          position: Object.freeze([slot.x, rider_y, slot.z] as const),
          facing_yaw: slot.yaw,
          anim,
          gait_scale: time_scale,
        })
      )
      if (!slot.loaded.pet) return [character]
      // ridden: the pet carries the rider at their position; unridden: it walks its own leash
      const follower = !mounted && Number.isFinite(slot.pet_motion.x)
      const pet_y = slot.y + pet_vertical_offset(slot.loaded.pet.locomotion, now / 1000)
      const pet_position = follower
        ? Object.freeze([slot.pet_motion.x, pet_y, slot.pet_motion.z] as const)
        : Object.freeze([slot.x, mounted ? slot.y : pet_y, slot.z] as const)
      const pet_moving = follower ? slot.pet_motion.moving : moving
      return [
        character,
        Object.freeze({
          id: pet_id,
          kind: 'mob' as const,
          model_url: slot.loaded.pet.model_url,
          anchor: Object.freeze({ kind: 'world' as const, position: pet_position }),
          facing: Object.freeze({ kind: 'yaw' as const, yaw: follower ? slot.pet_motion.yaw : slot.yaw }),
          animation: Object.freeze({
            name: pet_moving ? ('RUN' as const) : ('IDLE' as const),
            time_scale: pet_moving ? 1.5 * time_scale : time_scale,
          }),
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
    /** Shown (interpolated, CLIENT-space) positions — the screen-space pick reads these so a
     *  right-click lands on the body the eye sees, not the network target it chases. */
    positions: (): readonly Readonly<{ character_id: string; x: number; y: number; z: number }>[] =>
      Object.freeze(
        [...slots.entries()]
          .filter(([, slot]) => slot.loaded)
          .map(([character_id, slot]) => Object.freeze({ character_id, x: slot.x, y: slot.y, z: slot.z }))
      ),
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
          // a new arrival spawns AT its target — only subsequent moves interpolate
          slots.set(character_id, {
            source_key,
            loaded: null,
            x: slot?.x ?? x,
            y: slot?.y ?? row.y,
            z: slot?.z ?? z,
            tx: x,
            ty: row.y,
            tz: z,
            yaw: slot?.yaw ?? 0,
            moved_at: 0,
            riding: row.riding,
            pet_motion: slot?.pet_motion ?? empty_pet_motion(),
          })
          load(character_id, row, source_key)
          changed = true
          continue
        }
        if (row.riding !== slot.riding) {
          slot.riding = row.riding
          changed = true
          wake_tick()
        }
        const dx = x - slot.tx
        const dz = z - slot.tz
        if (dx !== 0 || dz !== 0 || row.y !== slot.ty) {
          slot.yaw = dx * dx + dz * dz > 0.000_1 ? Math.atan2(dx, dz) : slot.yaw
          slot.tx = x
          slot.ty = row.y
          slot.tz = z
          slot.moved_at = now
          changed = true
          wake_tick()
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
