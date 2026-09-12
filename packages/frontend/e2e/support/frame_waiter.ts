// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Compatibility observes real elapsed time; benchmarks also require the requested sample count. */
export const create_frame_waiter =
  ({
    benchmark = false,
    mode = 'smoke',
    now = () => performance.now(),
    next_frame = () => new Promise<number>(requestAnimationFrame),
  }: Readonly<{
    benchmark?: boolean
    mode?: 'full' | 'smoke'
    now?: () => number
    next_frame?: () => Promise<number>
  }>) =>
  async (frames: number, update: (frame: number) => void = () => undefined): Promise<void> => {
    const end_at = now() + frames * (1000 / 60)
    const minimum_frames = benchmark || mode === 'full' ? frames : 2
    for (let frame = 0; frame < minimum_frames || now() < end_at; frame += 1) {
      update(frame)
      await next_frame()
    }
  }

/** State transitions finish on their observed result, independently of sampling duration. */
export const wait_for_frame_condition = async (
  ready: () => boolean,
  next_frame = () => new Promise<number>(requestAnimationFrame),
  now = () => performance.now()
): Promise<void> => {
  const deadline = now() + 30_000
  while (!ready()) {
    if (now() >= deadline) throw new Error('World transition did not reach its expected state')
    await next_frame()
  }
}
