// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE GAME'S LIVE SCENE. The engine module owns the one world the game runs in and publishes it
// here so the app shell can hand it to the fight surface. This is a lane between exactly TWO
// parties, not an ambient lookup: nothing reads a scene from here to draw into it. Every surface
// that draws receives its scene as an ARGUMENT from whoever owns it — a component that could ask
// a global "what world is live?" will eventually draw into somebody else's (it did, twice).
// Other stages — the simulator, the demo's fight tab — own their worlds through WorldStage and
// never touch this lane at all. Deliberately outside the app reducer, like the pose lane: a live
// engine handle is not state, it is a device.
//
// ENTITY OWNERSHIP IS EXCLUSIVE (owner 2026-08-21: "during a fight we only show fighters, noone
// else"). The scene carries ONE entity list, so two writers would clobber each other frame by
// frame. Instead a single source holds it at a time and the other's writes are dropped at this
// door — the rule is mechanical here, not a discipline every caller has to remember.

import type { EntityRender } from '@aresrpg/engine'

import type { create_world } from './world.ts'

type WorldApi = ReturnType<typeof create_world>

/** What a surface needs to draw a fight into the live scene — a SLICE of the running world, so
 *  the fight viewport consumes the same doors the world already exposes rather than a parallel
 *  vocabulary that would drift from them. */
export type SceneHandle = Pick<
  WorldApi,
  | 'show_fight_board'
  | 'set_entities'
  | 'animate_entity'
  | 'play_fight_cue'
  | 'project_entity'
  | 'create_fight_blob'
  | 'update_fight_blob'
  | 'remove_fight_blob'
  | 'pick_fight_cell'
  | 'ground_height'
  | 'set_quality'
>

/** The two surfaces that populate the scene's entity list. Never both. */
export type EntitySource = 'presence' | 'fight'

type Feed = {
  scene: SceneHandle | null
  owner: EntitySource
  listeners: Set<() => void>
}

const feed: Feed = { scene: null, owner: 'presence', listeners: new Set() }

const announce = (): void => {
  for (const listener of feed.listeners) listener()
}

/** The GAME engine publishes its running scene here, and null when it tears down. One publisher,
 *  by construction — no other surface may call this. */
export const publish_scene = (scene: SceneHandle | null): void => {
  feed.scene = scene
  // a torn-down world takes its ownership with it: leaving the list claimed by a fight that no
  // longer exists would silence presence for the whole of the next world
  if (!scene) feed.owner = 'presence'
  announce()
}

export const subscribe_scene = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_scene = (): SceneHandle | null => feed.scene

/** Take the entity list. The previous owner's entities are cleared in the same breath, so the
 *  world's other players are gone the instant a board mounts rather than lingering a frame. */
export const claim_scene_entities = (source: EntitySource): void => {
  if (feed.owner === source) return
  feed.owner = source
  feed.scene?.set_entities(Object.freeze([]))
  // the handover is announced: the new owner has just been emptied and has to repopulate, and
  // presence rebuilds only on a delta — without this, walking out of a fight leaves a still
  // crowd invisible until somebody happens to move
  announce()
}

/** Draw into the scene's entity list. A write from the source that does not hold it is dropped
 *  — that is the whole enforcement of "a fight shows its fighters and nobody else". */
export const submit_scene_entities = (source: EntitySource, entities: readonly EntityRender[]): void => {
  if (feed.owner !== source) return
  feed.scene?.set_entities(entities)
}
