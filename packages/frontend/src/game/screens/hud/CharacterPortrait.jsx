// Shared character sprite portrait — mounts the imperative sprite_preview (opaque-bbox CENTERED via
// `contain`) into a canvas, owning the preview lifecycle. One home for the characters drawer + the
// character surfaces so the sprite reads identically (centered, hue-shaded) everywhere.

import { useEffect, useRef } from 'react'

import { sprite_preview } from '../sprite-preview.js'

/**
 * @param {{ sprites: string, hue: number, size?: number, className?: string }} props
 * @returns {import('react').JSX.Element}
 */
export function CharacterPortrait({ sprites, hue, size = 96, className = 'chr-portrait' }) {
  const ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const preview = sprite_preview(canvas, {
      base: sprites,
      hue,
      contain: true,
    })
    return () => preview.destroy()
  }, [sprites, hue])
  return <canvas ref={ref} className={className} width={size} height={size} style={{ width: size, height: size }} />
}
