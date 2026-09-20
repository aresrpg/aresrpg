// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- this external-store adapter owns its mutable registries and platform elements. */
// One registry of scene-owned caption targets and interactive spawn elements.
// React supplies semantic content; the engine owns all per-frame placement.

import type { CaptionTarget } from '@aresrpg/engine'
import { useSyncExternalStore } from 'react'

export type NametagRegistry = Readonly<{
  others: Readonly<Record<string, CaptionTarget>>
  /** world spawns by their own id — one card per mob group or resource pack */
  spawns: Readonly<Record<string, HTMLElement>>
  self: CaptionTarget | null
}>

type Feed = {
  others: Map<string, CaptionTarget>
  spawns: Map<string, HTMLElement>
  self: CaptionTarget | null
  listeners: Set<() => void>
  /** cached snapshot — useSyncExternalStore compares by identity, so a rebuilt-every-read
   *  object would loop React forever */
  snapshot: NametagRegistry | null
}

const feed: Feed = { others: new Map(), spawns: new Map(), self: null, listeners: new Set(), snapshot: null }

const announce = (): void => {
  feed.snapshot = null
  for (const listener of feed.listeners) listener()
}

/** The presence layer's crown element for a nearby player — null detaches. */
export const publish_other_tag = (character_id: string, element: CaptionTarget | null): void => {
  if ((feed.others.get(character_id) ?? null) === element) return
  if (element === null) feed.others.delete(character_id)
  else feed.others.set(character_id, element)
  announce()
}

/** A world spawn's element — one mob-group or resource-pack card. Null detaches. */
export const publish_spawn_tag = (spawn_id: string, element: HTMLElement | null): void => {
  if ((feed.spawns.get(spawn_id) ?? null) === element) return
  if (element === null) feed.spawns.delete(spawn_id)
  else feed.spawns.set(spawn_id, element)
  announce()
}

/** Our own crown element — attached only while the cursor hovers our body. */
export const publish_self_tag = (element: CaptionTarget | null): void => {
  if (feed.self === element) return
  feed.self = element
  announce()
}

export const subscribe_nametags = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

const read_registry = (): NametagRegistry => {
  if (feed.snapshot === null)
    feed.snapshot = Object.freeze({
      others: Object.freeze(Object.fromEntries(feed.others)),
      spawns: Object.freeze(Object.fromEntries(feed.spawns)),
      self: feed.self,
    })
  return feed.snapshot
}

export const useNametags = (): NametagRegistry => useSyncExternalStore(subscribe_nametags, read_registry, read_registry)
