// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Engine } from '@aresrpg/engine'

type SceneWork = Readonly<{ resident: number; planning: number; queued: number; in_flight: number; evicting: number }>

/** Both menu and gameplay prepare only after the requested terrain has reached the renderer. */
export const scene_work_complete = (settled: boolean, work: SceneWork, assets_ready: boolean): boolean =>
  assets_ready &&
  settled &&
  work.resident > 0 &&
  Math.max(0, work.planning) + work.queued + work.in_flight + work.evicting === 0

/** One preparation lifetime per scene configuration; retired GPU completions cannot reveal a replacement. */
export const create_scene_preparation = (engine: Pick<Engine, 'prepare_scene' | 'fail'>) => {
  type Request = Readonly<{ identity: object; phase: 'waiting' | 'preparing' | 'ready' }>
  const waiting = (): Request => ({ identity: {}, phase: 'waiting' })
  let current = waiting()
  let disposed = false
  return {
    ready: () => current.phase === 'ready',
    reset: () => {
      current = waiting()
    },
    tick: (available: () => boolean): void => {
      if (disposed || current.phase !== 'waiting' || !available()) return
      const { identity } = current
      current = { identity, phase: 'preparing' }
      void engine.prepare_scene().then(
        (ready) => {
          if (!disposed && current.identity === identity) current = { identity, phase: ready ? 'ready' : 'waiting' }
        },
        (error: unknown) => {
          if (disposed || current.identity !== identity) return
          engine.fail({
            code: 'graphics_unavailable',
            detail: String(error),
            stack: error instanceof Error ? error.stack : undefined,
          })
        }
      )
    },
    dispose: () => {
      disposed = true
    },
  }
}
