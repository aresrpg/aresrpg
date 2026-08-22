// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types -- this external-store adapter owns its mutable feed and platform elements. */
// The star-gate prompt lane (the mount-prompt lane's family): the world loop floats ONE element
// over the origin portal while pressing T would work and publishes that element here; React
// portals the chip's content into it. Per-frame presentation state stays OUTSIDE the app reducer.

import { useSyncExternalStore } from 'react'

type Feed = { root: HTMLElement | null; listeners: Set<() => void> }

const feed: Feed = { root: null, listeners: new Set() }

export const publish_portal_prompt = (root: HTMLElement | null): void => {
  if (root === feed.root) return
  feed.root = root
  for (const listener of feed.listeners) listener()
}

export const subscribe_portal_prompt = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_portal_prompt = (): HTMLElement | null => feed.root

export const usePortalPrompt = (): HTMLElement | null =>
  useSyncExternalStore(subscribe_portal_prompt, read_portal_prompt, () => null)
