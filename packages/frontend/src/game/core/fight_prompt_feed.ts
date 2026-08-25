// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
/* eslint-disable functional/immutable-data -- this external-store adapter owns and mutates its private feed. */
// The fight-prompt lane: the world loop floats one DOM element over every sword in public tag
// range and publishes the nearest interaction-eligible id beside that registry. React portals
// the shared nametag into each; per-frame presentation state stays outside the app reducer.

import { useSyncExternalStore } from 'react'

export const FIGHT_TAG_RANGE_BLOCKS = 50
export const FIGHT_INTERACTION_RANGE_BLOCKS = 4

export type FightPrompt = Readonly<{
  roots: Readonly<Record<string, HTMLElement>>
  focused_id: string | null
}>

export const fight_prompt_targets = (
  markers: readonly Readonly<{ id: string; x: number; z: number }>[],
  x: number,
  z: number
): Readonly<{ visible_ids: readonly string[]; focused_id: string | null }> => {
  const visible = markers
    .map((marker) => Object.freeze({ id: marker.id, distance: Math.hypot(marker.x - x, marker.z - z) }))
    .filter(({ distance }) => distance <= FIGHT_TAG_RANGE_BLOCKS)
    .toSorted((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
  return Object.freeze({
    visible_ids: Object.freeze(visible.map(({ id }) => id)),
    focused_id: visible.find(({ distance }) => distance <= FIGHT_INTERACTION_RANGE_BLOCKS)?.id ?? null,
  })
}

type Feed = { prompt: FightPrompt; listeners: Set<() => void> }

const feed: Feed = { prompt: { roots: Object.freeze({}), focused_id: null }, listeners: new Set() }

const announce = (): void => {
  for (const listener of feed.listeners) listener()
}

export const publish_fight_prompt = (prompt: FightPrompt): void => {
  const current_ids = Object.keys(feed.prompt.roots)
  const next_ids = Object.keys(prompt.roots)
  if (
    feed.prompt.focused_id === prompt.focused_id &&
    current_ids.length === next_ids.length &&
    current_ids.every((id) => feed.prompt.roots[id] === prompt.roots[id])
  )
    return
  feed.prompt = prompt
  announce()
}

export const subscribe_fight_feed = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_fight_prompt = (): FightPrompt => feed.prompt

export const useFightPrompt = (): FightPrompt =>
  useSyncExternalStore(subscribe_fight_feed, read_fight_prompt, () => feed.prompt)
