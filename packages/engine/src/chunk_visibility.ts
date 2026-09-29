// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Conservative CPU visibility for the terrain pool's indirect draw lists. Chunks remain the
// rendering/collision unit; this only stops submitting bounds that cannot affect a camera pass.

type PlaneLike = Readonly<{ normal: Readonly<{ x: number; y: number; z: number }>; constant: number }>

export const chunk_in_frustum = (
  origin: readonly [number, number, number],
  edge: number,
  planes: readonly PlaneLike[]
): boolean =>
  planes.every(({ normal, constant }) => {
    const x = origin[0] + (normal.x >= 0 ? edge : 0)
    const y = origin[1] + (normal.y >= 0 ? edge : 0)
    const z = origin[2] + (normal.z >= 0 ? edge : 0)
    return normal.x * x + normal.y * y + normal.z * z + constant >= 0
  })
