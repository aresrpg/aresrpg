// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Screen-space player pick — pure math over the last camera frame, no engine raycast: project
// each nearby body to pixels (perspective look-at, the same law the renderer applies) and take
// the closest one inside the cursor radius. The 10-block interaction law gates the candidates
// BEFORE projection — a player on the horizon is never a menu target.

import type { CameraFrame } from './cameras.ts'

export const PLAYER_INTERACT_RANGE_BLOCKS = 10
const PICK_RADIUS_PX = 48
/** The clickable body is the WHOLE character: the feet→crown segment in screen space (a single
 *  torso point left the head and feet dead, owner 2026-08-20). Crown sits at character height. */
const BODY_TOP = 2.0

export type PickCandidate = Readonly<{ character_id: string; x: number; y: number; z: number }>

export type PlayerPickInput = Readonly<{
  view: CameraFrame
  width: number
  height: number
  click_x: number
  click_y: number
  own: Readonly<{ x: number; y: number; z: number }>
  candidates: readonly PickCandidate[]
}>

/** World point → screen pixels under the renderer's perspective look-at — the ONE projection
 *  every screen-anchored overlay uses (the pick, the mount tag). Null = behind the camera. */
export const project_to_screen = (
  view: CameraFrame,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number
): readonly [number, number] | null => {
  const [cx, cy, cz] = view.position
  const [tx, ty, tz] = view.target
  const flen = Math.hypot(tx - cx, ty - cy, tz - cz)
  if (flen === 0 || width === 0 || height === 0) return null
  const fx = (tx - cx) / flen
  const fy = (ty - cy) / flen
  const fz = (tz - cz) / flen
  // right = forward × world-up, then true up = right × forward (renderer look-at basis)
  const rlen = Math.hypot(fz, fx)
  if (rlen === 0) return null
  const rx = -fz / rlen
  const rz = fx / rlen
  const ux = -rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy
  const half_h = Math.tan((view.fov * Math.PI) / 360)
  const half_w = (half_h * width) / height
  const vx = x - cx
  const vy = y - cy
  const vz = z - cz
  const depth = vx * fx + vy * fy + vz * fz
  if (depth <= 0) return null
  const sx = (((vx * rx + vz * rz) / (depth * half_w)) * 0.5 + 0.5) * width
  const sy = (1 - (((vx * ux + vy * uy + vz * uz) / (depth * half_h)) * 0.5 + 0.5)) * height
  return [sx, sy]
}

export const pick_player = ({
  view,
  width,
  height,
  click_x,
  click_y,
  own,
  candidates,
}: PlayerPickInput): string | null => {
  const project = (x: number, y: number, z: number) => project_to_screen(view, width, height, x, y, z)
  // distance from the click to the projected feet→crown SEGMENT — head and feet click too
  const distance_to_body = (candidate: PickCandidate): number | null => {
    const feet = project(candidate.x, candidate.y, candidate.z)
    const crown = project(candidate.x, candidate.y + BODY_TOP, candidate.z)
    if (!feet || !crown) return null
    const [ax, ay] = feet
    const [bx, by] = crown
    const abx = bx - ax
    const aby = by - ay
    const ab_sq = abx * abx + aby * aby
    const t = ab_sq === 0 ? 0 : Math.max(0, Math.min(1, ((click_x - ax) * abx + (click_y - ay) * aby) / ab_sq))
    return Math.hypot(ax + t * abx - click_x, ay + t * aby - click_y)
  }
  const picked = candidates.reduce<{ character_id: string; distance_px: number } | null>((best, candidate) => {
    if (Math.hypot(candidate.x - own.x, candidate.y - own.y, candidate.z - own.z) > PLAYER_INTERACT_RANGE_BLOCKS)
      return best
    const distance_px = distance_to_body(candidate)
    if (distance_px === null || distance_px > PICK_RADIUS_PX) return best
    return best && best.distance_px <= distance_px ? best : { character_id: candidate.character_id, distance_px }
  }, null)
  return picked?.character_id ?? null
}
