// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useRef } from 'react'

import { create_funding_texture, FUNDING_FRAME_MS, funding_texture_size } from './funding_texture.ts'

const texture_context = (canvas: HTMLCanvasElement): WebGLRenderingContext | null => {
  try {
    return canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' })
  } catch (error) {
    console.warn('Funding texture retain their gradient fallback.', error)
    return null
  }
}

const attach_texture = (canvas: HTMLCanvasElement): (() => void) => {
  const gl = texture_context(canvas)
  if (!gl) return () => undefined
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let shader: ReturnType<typeof create_funding_texture> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let visible = false
  const started = performance.now()
  const stop = (): void => clearTimeout(timer)
  const draw = (): void => {
    if (!shader || !visible || document.hidden) return
    const size = funding_texture_size(canvas.clientWidth, canvas.clientHeight)
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.setAttribute('width', String(size.width))
      canvas.setAttribute('height', String(size.height))
    }
    shader.draw(
      size.width,
      size.height,
      reduced.matches ? 0 : (performance.now() - started) / 1_000,
      Number(canvas.dataset.gold)
    )
    canvas.setAttribute('data-renderer', 'webgl')
    if (!reduced.matches) timer = setTimeout(draw, FUNDING_FRAME_MS)
  }
  const restart = (): void => {
    stop()
    draw()
  }
  const initialize = (): void => {
    try {
      shader?.dispose()
      shader = create_funding_texture(gl)
      restart()
    } catch (error) {
      shader = null
      canvas.setAttribute('data-renderer', 'fallback')
      console.warn('Funding texture retain their gradient fallback.', error)
    }
  }
  const lose = (event: Event): void => {
    event.preventDefault()
    stop()
    shader = null
    canvas.setAttribute('data-renderer', 'fallback')
  }
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    restart()
  })
  const resize = new ResizeObserver(restart)
  intersection.observe(canvas)
  resize.observe(canvas)
  canvas.addEventListener('webglcontextlost', lose)
  canvas.addEventListener('webglcontextrestored', initialize)
  document.addEventListener('visibilitychange', restart)
  reduced.addEventListener('change', restart)
  initialize()
  return () => {
    stop()
    intersection.disconnect()
    resize.disconnect()
    canvas.removeEventListener('webglcontextlost', lose)
    canvas.removeEventListener('webglcontextrestored', initialize)
    document.removeEventListener('visibilitychange', restart)
    reduced.removeEventListener('change', restart)
    shader?.dispose()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export const FundingTexture = ({ progress }: Readonly<{ progress: number }>) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => (canvas.current ? attach_texture(canvas.current) : undefined), [])
  return (
    <canvas
      aria-hidden="true"
      className="funding-texture"
      data-funding-texture=""
      data-gold={progress / 100}
      ref={canvas}
    />
  )
}
