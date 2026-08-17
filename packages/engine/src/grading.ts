// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Node } from 'three/webgpu'
import { clamp, float, mix, saturation, smoothstep, vec3 } from 'three/tsl'

type Rgb = readonly [number, number, number]

const GRADE = Object.freeze({
  contrast: 1.24,
  local_contrast: 1.12,
  pivot: 0.45,
  saturation: 1.16,
  vibrance: 0.12,
  lift: 0.006,
  shoulder: 0.09,
})
const LUMA: Rgb = [0.2126, 0.7152, 0.0722]

const clamp_01 = (value: number): number => Math.max(0, Math.min(1, value))
const smooth_01 = (value: number): number => {
  const amount = clamp_01(value)
  return amount * amount * (3 - 2 * amount)
}
const smooth_pivot = (value: number): number =>
  value <= GRADE.pivot
    ? 0.5 * smooth_01(value / GRADE.pivot)
    : 0.5 + 0.5 * smooth_01((value - GRADE.pivot) / (1 - GRADE.pivot))
const finish_channel = (value: number): number => {
  const shoulder = (value * (1 + GRADE.shoulder)) / (1 + GRADE.shoulder * value)
  return clamp_01(GRADE.lift + shoulder * (1 - GRADE.lift))
}
const luminance = (color: Rgb): number => color[0] * LUMA[0] + color[1] * LUMA[1] + color[2] * LUMA[2]
const finish_rgb = (color: Rgb): Rgb => {
  const luma = luminance(color)
  const saturated = color.map((channel) => luma + (channel - luma) * GRADE.saturation) as [number, number, number]
  const average = (saturated[0] + saturated[1] + saturated[2]) / 3
  const maximum = Math.max(...saturated)
  const amount = (maximum - average) * GRADE.vibrance * -3
  return saturated.map((channel) => clamp_01(channel + (maximum - channel) * amount)) as [number, number, number]
}

const grade_rgb_with_gain = (color: Rgb, gain: number): Rgb =>
  finish_rgb(
    color.map((channel) => {
      const value = clamp_01(channel)
      const local = value + (smooth_pivot(value) - value) * (GRADE.local_contrast - 1)
      return finish_channel(clamp_01(local * gain))
    }) as [number, number, number]
  )

export const grade_rgb = (color: Rgb): Rgb => grade_rgb_with_gain(color, 1)

export const grade_rgb_low_frequency = (color: Rgb, low_frequency_luma: number): Rgb => {
  const base = clamp_01(low_frequency_luma)
  const target = base + (smooth_pivot(base) - base) * (GRADE.contrast - 1)
  return grade_rgb_with_gain(color, target / Math.max(base, 1e-4))
}

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
