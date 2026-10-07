// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const BOX_CHARGE_MS = 1_200
export const BOX_BURST_MS = 500
export const BOX_SPIN_MS = 4_700

// One continuous speed curve owns both pixels and the inverse audio crossing schedule.
const RAMP = 0.12
const POWER = 5
const SPEED = 1 / (RAMP / 2 + (1 - RAMP) / POWER)
const RAMP_DISTANCE = (SPEED * RAMP) / 2

export const carousel_progress = (elapsed: number): number => {
  const time = Math.max(0, Math.min(1, elapsed))
  return time < RAMP
    ? RAMP_DISTANCE * (time / RAMP) ** 2
    : RAMP_DISTANCE + (1 - RAMP_DISTANCE) * (1 - ((1 - time) / (1 - RAMP)) ** POWER)
}

export const carousel_crossings = (target: number): readonly number[] =>
  Array.from({ length: target }, (_, index) => {
    const distance = (index + 0.5) / target
    const time =
      distance < RAMP_DISTANCE
        ? RAMP * Math.sqrt(distance / RAMP_DISTANCE)
        : 1 - (1 - RAMP) * ((1 - distance) / (1 - RAMP_DISTANCE)) ** (1 / POWER)
    return time * BOX_SPIN_MS
  })

export const carousel_plan = (pool: readonly string[], result: string) => {
  const selected = pool.indexOf(result)
  if (selected < 0) throw new Error('The confirmed reward is not in this crate')
  const target = Math.max(2, Math.ceil(30 / pool.length)) * pool.length + selected
  return { target, items: Array.from({ length: target + 4 }, (_, index) => pool[index % pool.length]!) }
}
