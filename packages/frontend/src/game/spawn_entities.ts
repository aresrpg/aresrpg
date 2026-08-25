// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- this renderer owns its mutable animation cache and Three.js-facing elements. */
// THE ZONE'S MOBS, RENDERED. The chain draws a group as a point and a roster; this turns that
// into bodies standing in a ring around the point, each ambling on its own leash
// (core/spawn_wander.ts), and floats ONE nametag over the pack — a group is a UNIT you engage,
// not a crowd of individuals, so it gets one card listing its members rather than N cards.
//
// Every tracked group stays in this renderer as live truth. Bodies exist only inside the render
// radius; distance changes presentation, never which tracked mobs the client knows about.
//
// Lifecycle mirrors presence_entities.ts (its sibling under one entity list): update() folds a
// delta, a rAF loop advances the wander while anything moves, and build() submits the whole list.

import type { EntityRender } from '@aresrpg/engine'
import { mulberry } from '@aresrpg/engine'

import { mob_entity, mob_model_scalar_for_roll } from './mob_entities.ts'
import {
  group_label_anchor,
  seated_group_ring,
  start_wander,
  step_wander,
  wander_seed,
  type WanderState,
} from './core/spawn_wander.ts'
import { rendered_groups, type WorldMobGroup } from './core/spawn_residency.ts'
import { publish_spawn_tag } from './core/nametag_feed.ts'
import { read_pose } from './core/pose_feed.ts'

/** Packs advertise themselves before their bodies fill the screen; E still selects the nearest card. */
export const MOB_TAG_RANGE_BLOCKS = 50
/** A member this far away freezes its mixer on the idle pose — animation costs nothing far off. */
const ANIMATION_RANGE_BLOCKS = 60

// bun's test runtime has no requestAnimationFrame — a timer keeps the module loadable there
const raf: (callback: (now: number) => void) => void =
  typeof globalThis.requestAnimationFrame === 'function'
    ? (callback) => globalThis.requestAnimationFrame(callback)
    : (callback) => void setTimeout(() => callback(performance.now()), 16)

type MemberSlot = {
  /** the entity id — `${group}:${ordinal}`, stable so the engine keeps the loaded model */
  id: string
  mob_type: string
  model_level_scalar: number
  wander: WanderState
  random: () => number
  /** ground height under the member, re-sampled as it ambles across columns */
  y: number
  /** the column the height was sampled on — a cheap "did it cross a block" check */
  column: string
}

type GroupSlot = {
  row: WorldMobGroup
  members: readonly MemberSlot[]
}

export const create_spawn_renderer = ({
  submit,
  ground_height,
  entity_height,
  label,
}: Readonly<{
  submit: (entities: readonly EntityRender[]) => void
  ground_height: (x: number, z: number) => number
  entity_height: (id: string) => number | null
  label: (group_id: string, element: HTMLElement | null, position: readonly [number, number, number] | null) => void
}>) => {
  const groups = new Map<string, GroupSlot>()
  let tracked_groups: readonly WorldMobGroup[] = Object.freeze([])
  /** group id → its one card; the engine anchors it at the live member centroid */
  const tagged = new Map<string, HTMLElement>()
  let disposed = false
  let ticking = false
  let last_tick_ms = 0

  const seat_members = (row: WorldMobGroup): readonly MemberSlot[] =>
    seated_group_ring(row.members.length, row.x, row.z, ground_height).map((seat, ordinal) => {
      const anchor = { x: row.x + seat.dx, z: row.z + seat.dz, yaw: seat.yaw }
      // the seed is the GROUP's chain index and the ordinal, so a member ambles the same way
      // across reloads and never teleports when the population re-streams
      const random = mulberry(wander_seed(hash_group(row.id), ordinal))
      return {
        id: `${row.id}:${ordinal}`,
        mob_type: row.members[ordinal]!.mob_type,
        model_level_scalar: mob_model_scalar_for_roll(
          row.members[ordinal]!.mob_type,
          row.members[ordinal]!.level_scalar
        ),
        wander: start_wander(anchor, random),
        random,
        y: ground_height(anchor.x, anchor.z),
        column: column_of(anchor.x, anchor.z),
      }
    })

  /** attach/detach a pack's card — range-gated, and only while the pack is actually placed. */
  const sync_tag = (group_id: string): void => {
    const slot = groups.get(group_id)
    const own = read_pose()
    const anchor = slot
      ? group_label_anchor(
          slot.members.map((member) => ({
            x: member.wander.x,
            y: member.y,
            z: member.wander.z,
            height: entity_height(member.id),
          }))
        )
      : null
    const within = !!slot && !!own && !!anchor && Math.hypot(anchor.x - own.x, anchor.z - own.z) <= MOB_TAG_RANGE_BLOCKS
    const attached = tagged.get(group_id) ?? null
    if (within && anchor) {
      const div = attached ?? (typeof document === 'undefined' ? null : document.createElement('div'))
      if (!div) return
      label(group_id, div, [anchor.x, anchor.y, anchor.z])
      if (!attached) {
        tagged.set(group_id, div)
        publish_spawn_tag(group_id, div)
      }
    } else if (attached) {
      label(group_id, null, null)
      tagged.delete(group_id)
      publish_spawn_tag(group_id, null)
    }
  }

  const drop_tag = (group_id: string): void => {
    const attached = tagged.get(group_id)
    if (!attached) return
    label(group_id, null, null)
    tagged.delete(group_id)
    publish_spawn_tag(group_id, null)
  }

  const build = (): void => {
    if (disposed) return
    const own = read_pose()
    const entities = [...groups.values()].flatMap(({ members }) =>
      members.flatMap((member): EntityRender[] => {
        const far = own ? Math.hypot(member.wander.x - own.x, member.wander.z - own.z) > ANIMATION_RANGE_BLOCKS : false
        const moving = member.wander.moving && !far
        const entity = mob_entity({
          id: member.id,
          mob_type: member.mob_type,
          anchor: Object.freeze({
            kind: 'world' as const,
            position: Object.freeze([member.wander.x, member.y, member.wander.z] as const),
          }),
          facing: Object.freeze({ kind: 'yaw' as const, yaw: member.wander.yaw }),
          level_scalar: member.model_level_scalar,
        })
        return entity
          ? [
              Object.freeze({
                ...entity,
                // A WANDERING MOB IS WALKING. It ambles at WANDER_SPEED — a stroll — so it plays
                // the WALK clip at its own authored speed. Slowing a RUN clip down to fake a
                // stroll is what reads as slow motion: the legs keep a sprint's shape at a
                // fraction of its rate, and no time_scale rescues the wrong clip.
                animation: Object.freeze({
                  name: moving ? ('WALK' as const) : ('IDLE' as const),
                  time_scale: far ? 0 : 1,
                }),
              }),
            ]
          : []
      })
    )
    submit(Object.freeze(entities))
  }

  const tick = (now: number): void => {
    if (disposed) return
    const delta_seconds = Math.min((now - last_tick_ms) / 1000, 0.25)
    last_tick_ms = now
    let moving = false
    for (const slot of groups.values())
      for (const member of slot.members) {
        member.wander = step_wander(member.wander, delta_seconds, member.random)
        if (!member.wander.moving) continue
        moving = true
        // re-ground only when it actually crosses a column — a height sample per member per
        // frame is the kind of cost that only shows up on somebody else's machine
        const column = column_of(member.wander.x, member.wander.z)
        if (column !== member.column) {
          member.column = column
          member.y = ground_height(member.wander.x, member.wander.z)
        }
      }
    build()
    for (const group_id of groups.keys()) sync_tag(group_id)
    // the loop never stops while anything is placed: a member is always either ambling or
    // counting down to its next decision, and the countdown is what makes it start again
    ticking = groups.size > 0
    if (ticking) raf(tick)
    else void moving
  }

  const wake = (): void => {
    if (ticking || disposed || groups.size === 0) return
    ticking = true
    last_tick_ms = performance.now()
    raf(tick)
  }

  const refresh = (): void => {
    if (disposed) return
    const own = read_pose()
    const wanted = own ? rendered_groups(tracked_groups, own) : []
    const keep = new Set(wanted.map(({ id }) => id))
    let changed = false
    for (const group_id of [...groups.keys()])
      if (!keep.has(group_id)) {
        drop_tag(group_id)
        groups.delete(group_id)
        changed = true
      }
    for (const row of wanted) {
      const known = groups.get(row.id)
      if (known && roster_of(known.row) === roster_of(row)) continue
      if (known) drop_tag(row.id)
      groups.set(row.id, { row, members: seat_members(row) })
      changed = true
    }
    if (changed) build()
    for (const group_id of groups.keys()) sync_tag(group_id)
    wake()
  }

  return Object.freeze({
    /** Retain the complete tracked population; refresh alone decides which bodies are visible. */
    update: (live: readonly WorldMobGroup[]): void => {
      tracked_groups = Object.freeze([...live])
      refresh()
    },
    refresh,
    dispose: (): void => {
      disposed = true
      tracked_groups = Object.freeze([])
      for (const group_id of [...groups.keys()]) drop_tag(group_id)
      groups.clear()
      submit(Object.freeze([]))
    },
  })
}

/** A group's roster as one comparable string — species and levels, in seat order. */
const roster_of = (row: WorldMobGroup): string =>
  row.members.map(({ mob_type, level_scalar }) => `${mob_type}@${level_scalar}`).join(',')

/** The group id folded to a number for the wander seed — ids are `world:zx:zz:mN` strings. */
const hash_group = (id: string): number => {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0
  return hash >>> 0
}

const column_of = (x: number, z: number): string => `${Math.floor(x)}:${Math.floor(z)}`
