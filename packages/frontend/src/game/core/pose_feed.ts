// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this external-store adapter owns and mutates its private pose feed. */
// The live pose lane: the world loop publishes the controlled character's pose ~20 Hz and the
// HUD (compass, minimap) reads it through useSyncExternalStore — deliberately OUTSIDE the app
// reducer, which never carries per-frame presentation state.

import { useSyncExternalStore } from 'react'

export type WorldPose = Readonly<{
  /** The controlled entity that produced this pose. Selection is not a pose identity. */
  character_id: string
  x: number
  y: number
  z: number
  /** camera rig yaw (radians) — compass heading derives as wrap_pi(-yaw) */
  yaw: number
  /** mounted on the equipped pet right now — rides the position stream to other players */
  riding: boolean
  gliding: boolean
  /** 0..1 through the celestial cycle — feeds the day/night bar */
  time_of_day: number
  /** Actual manual world input; automatic travel and companion following do not qualify. */
  manual_movement?: boolean
  /** Remaining planned walking distance; absent until a complete route is known. */
  route?: Readonly<{ x: number; z: number; remaining: number | null }> | null
}>

const PUBLISH_MS = 50

type Feed = {
  pose: WorldPose | null
  last_ms: number
  listeners: Set<() => void>
  observed: WorldPose | null
  observed_ms: number
  display_listeners: Set<() => void>
}

const feed: Feed = {
  pose: null,
  last_ms: 0,
  listeners: new Set(),
  observed: null,
  observed_ms: 0,
  display_listeners: new Set(),
}

export const publish_pose = (pose: WorldPose | null): void => {
  const now = performance.now()
  if (pose !== null && feed.pose !== null && now - feed.last_ms < PUBLISH_MS) return
  feed.pose = pose
  feed.last_ms = now
  for (const listener of feed.listeners) listener()
  for (const listener of feed.display_listeners) listener()
}

export const subscribe_pose = (listener: () => void): (() => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

export const read_pose = (): WorldPose | null => feed.pose

export const pose_matches_character = (pose: WorldPose | null, character_id: string | null): pose is WorldPose =>
  pose !== null && character_id !== null && pose.character_id === character_id

export const useWorldPose = (): WorldPose | null => useSyncExternalStore(subscribe_pose, read_pose, () => null)

/** Camera presentation only. This never reaches controlled-pose subscribers or movement publication. */
export const publish_observed_pose = (pose: WorldPose | null): void => {
  if (pose === feed.observed) return
  const now = performance.now()
  if (pose !== null && feed.observed !== null && now - feed.observed_ms < PUBLISH_MS) return
  feed.observed = pose
  feed.observed_ms = now
  for (const listener of feed.display_listeners) listener()
}
export const read_displayed_pose = (): WorldPose | null => feed.observed ?? feed.pose
export const subscribe_displayed_pose = (listener: () => void): (() => void) => {
  feed.display_listeners.add(listener)
  return () => void feed.display_listeners.delete(listener)
}
export const useDisplayedWorldPose = (): WorldPose | null =>
  useSyncExternalStore(subscribe_displayed_pose, read_displayed_pose, () => null)
