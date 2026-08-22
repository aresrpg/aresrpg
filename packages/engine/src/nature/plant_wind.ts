// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { attribute, cos, positionLocal, sin, time, vec3 } from 'three/tsl'

/** One rooted wind deformation for terrain scatter and gatherable plants. */
export const plant_wind_position = () => {
  const sway = attribute('sway', 'float' as const)
  const phase = attribute('phase', 'float' as const)
  return positionLocal.add(
    vec3(
      sin(phase.add(time.mul(1.6)))
        .mul(sway)
        .mul(0.1),
      0,
      cos(phase.add(time.mul(1.1)))
        .mul(sway)
        .mul(0.06)
    )
  )
}
