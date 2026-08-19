// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The live pose lane: the world loop publishes the controlled character's pose ~20 Hz and the
// HUD (compass, minimap) reads it through useSyncExternalStore — deliberately OUTSIDE the app
// reducer, which never carries per-frame presentation state.

import { useSyncExternalStore } from 'react'

export type WorldPose = Readonly<{
  x: number
  y: number
  z: number
  /** camera rig yaw (radians) — compass heading derives as wrap_pi(-yaw) */
  yaw: number
  /** 0..1 through the celestial cycle — feeds the day/night bar */
  time_of_day: number
}>

const PUBLISH_MS = 50

type Feed = {
  pose: WorldPose | null
  last_ms: number
  listeners: Set<() => void>
}

const feed: Feed = { pose: null, last_ms: 0, listeners: new Set() }

export const publish_pose = (pose: WorldPose | null): void => {
  const now = performance.now()
  if (pose !== null && feed.pose !== null && now - feed.last_ms < PUBLISH_MS) return
  feed.pose = pose
  feed.last_ms = now
  for (const listener of feed.listeners) listener()
}

export const subscribe_pose = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_pose = (): WorldPose | null => feed.pose

export const useWorldPose = (): WorldPose | null => useSyncExternalStore(subscribe_pose, read_pose, () => null)
