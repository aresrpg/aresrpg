// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this external-store adapter owns its private feed. */

import { useSyncExternalStore } from 'react'

import type { DungeonPortalMarker } from '../../modules/world.ts'

export const DUNGEON_PORTAL_TAG_RANGE = 50
export const DUNGEON_PORTAL_INTERACTION_RANGE = 4

export type DungeonPortalPrompt = Readonly<{
  roots: Readonly<Record<string, HTMLElement>>
  portals: Readonly<Record<string, DungeonPortalMarker>>
  focused_id: string | null
}>

export const dungeon_portal_targets = (
  portals: readonly DungeonPortalMarker[],
  x: number,
  z: number
): Readonly<{ visible_ids: readonly string[]; focused_id: string | null }> => {
  const visible = portals
    .map((portal) => Object.freeze({ id: portal.id, distance: Math.hypot(portal.x - x, portal.z - z) }))
    .filter(({ distance }) => distance <= DUNGEON_PORTAL_TAG_RANGE)
    .toSorted((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
  return Object.freeze({
    visible_ids: Object.freeze(visible.map(({ id }) => id)),
    focused_id: visible.find(({ distance }) => distance <= DUNGEON_PORTAL_INTERACTION_RANGE)?.id ?? null,
  })
}

type Feed = { prompt: DungeonPortalPrompt; listeners: Set<() => void> }
const EMPTY = Object.freeze({ roots: Object.freeze({}), portals: Object.freeze({}), focused_id: null })
const feed: Feed = { prompt: EMPTY, listeners: new Set() }

export const publish_dungeon_portal_prompt = (prompt: DungeonPortalPrompt): void => {
  const current_ids = Object.keys(feed.prompt.roots)
  const next_ids = Object.keys(prompt.roots)
  if (
    feed.prompt.focused_id === prompt.focused_id &&
    current_ids.length === next_ids.length &&
    current_ids.every(
      (id) => feed.prompt.roots[id] === prompt.roots[id] && feed.prompt.portals[id] === prompt.portals[id]
    )
  )
    return
  feed.prompt = prompt
  for (const listener of feed.listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_dungeon_portal_prompt = (): DungeonPortalPrompt => feed.prompt
export const useDungeonPortalPrompt = (): DungeonPortalPrompt =>
  useSyncExternalStore(subscribe, read_dungeon_portal_prompt, () => feed.prompt)
