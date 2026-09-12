// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** One simulation clock consumes render/background frames in bounded physics steps. */
export const create_world_ticker = ({
  tick,
  now = () => performance.now(),
}: Readonly<{
  tick: (at_ms: number, delta_seconds: number) => void
  now?: () => number
}>) => {
  let active = false
  let background = false
  let last_ms = now()

  return Object.freeze({
    advance: (at_ms: number): void => {
      if (!active) return
      // A throttled one-second frame still walks normally; a suspended tab never teleports
      // through minutes of accumulated movement when it wakes.
      const elapsed_ms = Math.min(background ? 1_000 : 100, Math.max(0, at_ms - last_ms))
      last_ms = at_ms
      const steps = Math.ceil(elapsed_ms / 100)
      for (let step = 1; step <= steps; step += 1)
        tick(at_ms - elapsed_ms + (elapsed_ms * step) / steps, elapsed_ms / steps / 1_000)
    },
    set_active: (next: boolean, run_in_background: boolean): void => {
      if (next !== active) last_ms = now()
      active = next
      background = run_in_background
    },
    dispose: (): void => {
      active = false
    },
  })
}
