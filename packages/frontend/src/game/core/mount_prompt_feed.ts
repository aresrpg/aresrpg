// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The mount-prompt lane: the world loop hands the engine a DOM element to float over the pet
// (three CSS2D labels — the ENGINE positions it every frame, so it never lags the render) and
// publishes that element here; React portals the chip's CONTENT into it. Per-frame presentation
// state stays OUTSIDE the app reducer.

import { useSyncExternalStore } from 'react'

type Feed = { root: HTMLElement | null; listeners: Set<() => void> }

const feed: Feed = { root: null, listeners: new Set() }

export const publish_mount_prompt = (root: HTMLElement | null): void => {
  if (root === feed.root) return
  feed.root = root
  for (const listener of feed.listeners) listener()
}

export const subscribe_mount_prompt = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_mount_prompt = (): HTMLElement | null => feed.root

export const useMountPrompt = (): HTMLElement | null =>
  useSyncExternalStore(subscribe_mount_prompt, read_mount_prompt, () => null)
