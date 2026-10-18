// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Engine } from '@aresrpg/engine'

import { dispatch_app } from '../../store.ts'

/** Sample the renderer's counter, never a second animation loop that counts empty browser frames. */
export const observe_frame_rate = (engine: Pick<Engine, 'frame_count'>): (() => void) => {
  const source = crypto.randomUUID()
  let frames = engine.frame_count()
  let sampled_at = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    const next_frames = engine.frame_count()
    dispatch_app({
      type: 'engine/frames',
      source,
      sample: { frames: next_frames - frames, elapsed_ms: now - sampled_at },
    })
    frames = next_frames
    sampled_at = now
  }, 500)
  return () => {
    clearInterval(timer)
    dispatch_app({ type: 'engine/frames', source, sample: null })
  }
}
