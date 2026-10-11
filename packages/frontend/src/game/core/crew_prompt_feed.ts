// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this scene-bound external-store adapter owns its DOM handle and subscriptions. */
import { useSyncExternalStore } from 'react'

const feed: { root: Readonly<HTMLElement> | null; listeners: Set<() => void> } = { root: null, listeners: new Set() }

export const publish_crew_prompt = (root: Readonly<HTMLElement> | null): void => {
  if (feed.root === root) return
  feed.root = root
  for (const listener of feed.listeners) listener()
}

const subscribe = (listener: () => void) => {
  feed.listeners.add(listener)
  return () => {
    feed.listeners.delete(listener)
  }
}

export const useCrewPrompt = (): HTMLElement | null =>
  useSyncExternalStore(
    subscribe,
    () => feed.root,
    () => null
  )
