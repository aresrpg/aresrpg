// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'
import { create_caption_raster, type WorldCaption } from '@aresrpg/engine'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'
import { Panel } from '@aresrpg/ui'

import { player_caption } from '../../components/player_caption.ts'
import { content_catalog } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'

/** Present the game's actual raster at its native CSS size, without a world or GPU atlas. */
const CaptionPreview = ({ caption }: Readonly<{ caption: WorldCaption }>) => {
  const canvas_ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvas_ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Caption preview canvas is unavailable')
    const paint = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const { width, height } = raster.paint(caption, ratio)
      /* eslint-disable functional/immutable-data -- This effect owns the preview canvas dimensions and pixels. */
      canvas.width = Math.ceil(width * ratio)
      canvas.height = Math.ceil(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      /* eslint-enable functional/immutable-data */
      context.drawImage(raster.canvas, 0, 0)
    }
    const raster = create_caption_raster(paint)
    paint()
    document.fonts.addEventListener('loadingdone', paint)
    return () => {
      document.fonts.removeEventListener('loadingdone', paint)
      raster.dispose()
    }
  }, [caption])
  return (
    <canvas
      ref={canvas_ref}
      role="img"
      aria-label={[
        caption.name + (caption.suffix ?? []).map(({ text }) => text).join(''),
        ...(caption.lines ?? []).map(({ text }) => text),
      ].join(' · ')}
    />
  )
}

export const TitlesExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const titles = [
    { id: 'none', title: null, name: copy.ui.design_no_title, owner: null },
    ...content_catalog.items
      .filter(({ category }) => category === 'title')
      .map(({ item_type, name }) => ({ id: item_type, title: item_type, name, owner: null })),
    { id: 'admin', title: null, name: copy.admin, owner: DEFAULT_ADMIN_ADDRESS },
  ]
  return (
    <div className="ui-workshop-grid">
      {titles.map(({ id, title, name, owner }) => (
        <Panel key={id}>
          <h2>{name}</h2>
          <div className="flex min-h-40 items-center justify-center" data-nameplate-title={id}>
            <CaptionPreview
              caption={player_caption({
                name: 'Sceat',
                title,
                owner,
                admin_label: copy.admin,
                veteran_label: copy.ui.nameplate_veteran,
              })}
            />
          </div>
        </Panel>
      ))}
    </div>
  )
}
