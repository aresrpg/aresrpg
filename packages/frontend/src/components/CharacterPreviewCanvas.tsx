// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_preview, type CharacterPreview } from '@aresrpg/engine'
import { useEffect, useRef } from 'react'

import { load_character_appearance, type CharacterRenderSource } from '../game/character_entities.ts'

export const CharacterPreviewCanvas = ({
  source,
  pedestal = false,
}: Readonly<{ source: CharacterRenderSource; pedestal?: boolean }>) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<Promise<CharacterPreview> | null>(null)
  useEffect(() => {
    if (!canvas.current) return
    const created = create_character_preview(canvas.current, { pedestal })
    // eslint-disable-next-line functional/immutable-data -- this ref retains the owned preview device.
    preview.current = created
    void created.catch((error: unknown) => console.error('Character preview failed to initialize.', error))
    return () => {
      void created
        .then((handle) => handle.dispose())
        .catch((error: unknown) => console.error('Character preview could not finish disposal.', error))
    }
  }, [pedestal])
  useEffect(() => {
    let active = true
    void Promise.all([preview.current, load_character_appearance(source)])
      .then(async ([handle, appearance]) => {
        if (active && handle) await handle.set_appearance(appearance)
      })
      .catch((error: unknown) => console.error('Character preview failed to load its appearance.', error))
    return () => {
      active = false
    }
  }, [source])
  return (
    <canvas
      className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing"
      data-character-preview=""
      ref={canvas}
    />
  )
}
