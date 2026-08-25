// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- this external-store adapter owns its mutable registries and platform elements. */
// The nametag lane (the mount-prompt lane's family): the presence layer floats ONE crown
// element per nearby player, the spawn layer floats ONE per mob group and resource pack, and the
// world loop floats the self tag while the cursor hovers our body; React portals the ornate card
// into each. Per-frame presentation state stays OUTSIDE the app reducer.
//
// One lane, three registries, because they are one FACT — "which elements currently want a card
// portaled into them". A second feed for spawns would mean two subscriptions, two snapshots and
// two chances to leak an element the engine has already detached.

import { useSyncExternalStore } from 'react'

export type NametagRegistry = Readonly<{
  others: Readonly<Record<string, HTMLElement>>
  /** world spawns by their own id — one card per mob group or resource pack */
  spawns: Readonly<Record<string, HTMLElement>>
  self: HTMLElement | null
}>

type Feed = {
  others: Map<string, HTMLElement>
  spawns: Map<string, HTMLElement>
  self: HTMLElement | null
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
export const publish_other_tag = (character_id: string, element: HTMLElement | null): void => {
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
export const publish_self_tag = (element: HTMLElement | null): void => {
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
