// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Node } from 'three/webgpu'
import { clamp, float, mix, saturation, smoothstep, vec3 } from 'three/tsl'

const GRADE = Object.freeze({
  contrast: 1.18,
  local_contrast: 1.1,
  pivot: 0.45,
  saturation: 1.08,
  vibrance: 0.08,
  lift: 0.006,
  shoulder: 0.09,
})

export const create_grade_node = (
  sun_y: Node<'float'>
): ((color: Node<'vec3'>, low_frequency_luma: Node<'float'>) => Node<'vec3'>) => {
  const pivot = float(GRADE.pivot)
  const lift = float(GRADE.lift)
  const shoulder = float(GRADE.shoulder)
  const smooth_pivot_node = (value: Node<'float'>): Node<'float'> => {
    const low = smoothstep(0, 1, value.div(pivot)).mul(0.5)
    const high = smoothstep(0, 1, value.sub(pivot).div(float(1).sub(pivot)))
      .mul(0.5)
      .add(0.5)
    return value.greaterThan(pivot).select(high, low)
  }
  const finish_channel_node = (value: Node<'float'>): Node<'float'> => {
    const shoulder_value = value.mul(shoulder.add(1)).div(shoulder.mul(value).add(1))
    return clamp(lift.add(shoulder_value.mul(float(1).sub(lift))), 0, 1)
  }
  return (color, low_frequency_luma) => {
    const base = clamp(low_frequency_luma, 0, 1)
    const target = base.add(
      smooth_pivot_node(base)
        .sub(base)
        .mul(GRADE.contrast - 1)
    )
    const gain = target.div(base.max(1e-4))
    const channel = (value: Node<'float'>): Node<'float'> =>
      finish_channel_node(
        clamp(
          value
            .add(
              smooth_pivot_node(value)
                .sub(value)
                .mul(GRADE.local_contrast - 1)
            )
            .mul(gain),
          0,
          1
        )
      )
    const contrasted = vec3(channel(color.x), channel(color.y), channel(color.z))
    const daylight = smoothstep(-0.12, 0.02, sun_y)
    const saturation_amount = float(GRADE.saturation).mul(mix(float(0.4), float(1), daylight))
    const saturated = saturation(contrasted, saturation_amount)
    const average = saturated.x.add(saturated.y).add(saturated.z).div(3)
    const maximum = saturated.x.max(saturated.y.max(saturated.z))
    const amount = maximum.sub(average).mul(GRADE.vibrance * -3)
    return mix(saturated, vec3(maximum), amount).clamp(0, 1)
  }
}
