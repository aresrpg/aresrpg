// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A STAGE: one canvas, one world, handed to whoever draws on it. Surfaces that are not the game
// — the fight simulator, the demo's fight tab — need a real world to mount a board in, and they
// need it to be THEIRS. Ownership is the whole point: children receive the handle as an argument,
// so a component physically cannot reach a world it was not given. Nothing here is global, and
// nothing looks a scene up by ambient lookup.

import { useEffect, useState } from 'react'

import type { EngineQuality } from '@aresrpg/engine'

import { create_world } from './world.ts'
import type { SceneHandle } from './scene_feed.ts'

export const WorldStage = ({
  terrain,
  quality,
  children,
}: Readonly<{
  terrain: unknown
  quality: EngineQuality
  /** rendered once the world exists; the handle is the ONLY way in */
  children: (scene: SceneHandle) => React.ReactNode
}>) => {
  const [canvas, set_canvas] = useState<HTMLCanvasElement | null>(null)
  const [scene, set_scene] = useState<SceneHandle | null>(null)

  useEffect(() => {
    if (!canvas || !terrain) return undefined
    const world = create_world({ canvas, world: terrain, quality })
    world.set_active(true)
    set_scene(() => world)
    return () => {
      set_scene(null)
      world.dispose()
    }
    // the world's identity is its terrain and its canvas; quality rides its own door below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, terrain])

  useEffect(() => {
    scene?.set_quality(quality, null)
  }, [quality, scene])

  return (
    <>
      <canvas className="absolute inset-0 size-full touch-none" ref={set_canvas} />
      {scene ? children(scene) : null}
    </>
  )
}
