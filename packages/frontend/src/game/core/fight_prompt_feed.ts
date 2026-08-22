// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved.
/* eslint-disable functional/immutable-data -- this external-store adapter owns and mutates its private feed. */
// The fight-prompt lane (the mount-prompt lane's twin): the world loop floats ONE DOM element
// over the nearest sword marker and publishes it here together with that marker's id; React
// portals the chip's CONTENT (lock, join tag, spectate tag) into it. Per-frame presentation
// state stays OUTSIDE the app reducer.

import { useSyncExternalStore } from 'react'

export type FightPrompt = Readonly<{ root: HTMLElement | null; focused_id: string | null }>

type Feed = { prompt: FightPrompt; listeners: Set<() => void> }

const feed: Feed = { prompt: { root: null, focused_id: null }, listeners: new Set() }

const announce = (): void => {
  for (const listener of feed.listeners) listener()
}

export const publish_fight_prompt = (prompt: FightPrompt): void => {
  if (feed.prompt.root === prompt.root && feed.prompt.focused_id === prompt.focused_id) return
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
