// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// 2D pixel-sprite preview for the create/select carousels — draws a class's idle frame into
// the existing <canvas class="fog-sprite"> with crisp (nearest) upscaling and a CSS-style
// hue-rotate for the skin hue. Same { set_hue, destroy } handle the old 3D class_preview
// exposed, so the screens swap in with a one-line change. No WebGL — the sprite is pre-shaded.

const IDLE_DIR = 'south-east' // faces the camera, the classic select pose

/**
 * The opaque bounding box of an image's non-transparent pixels (so a sprite framed with uneven
 * transparent padding can be drawn CENTERED). Same-origin only; on a tainted canvas it returns null
 * and the caller falls back to the plain fill draw.
 * @param {HTMLImageElement} img @returns {{ x: number, y: number, w: number, h: number } | null}
 */
function opaque_bounds(img) {
  try {
    const oc = document.createElement('canvas')
    oc.width = img.naturalWidth
    oc.height = img.naturalHeight
    const octx = /** @type {CanvasRenderingContext2D} */ (oc.getContext('2d'))
    octx.drawImage(img, 0, 0)
    const { data, width, height } = octx.getImageData(0, 0, oc.width, oc.height)
    let min_x = width
    let min_y = height
    let max_x = -1
    let max_y = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < min_x) min_x = x
          if (x > max_x) max_x = x
          if (y < min_y) min_y = y
          if (y > max_y) max_y = y
        }
      }
    }
    if (max_x < min_x) return null
    return { x: min_x, y: min_y, w: max_x - min_x + 1, h: max_y - min_y + 1 }
  } catch {
    return null // cross-origin taint — caller falls back to a plain fill
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {string} opts.base       sprite base path (e.g. '/sprites/senshi')
 * @param {number} [opts.hue]      skin hue in degrees [0..360]
 * @param {boolean} [opts.contain] crop to the sprite's opaque box and CENTER it (true for the
 *                                 character-drawer portrait; defaults to the legacy fill behaviour)
 * @returns {{ set_hue: (deg: number) => void, destroy: () => void }}
 */
export function sprite_preview(canvas, { base, hue = 0, contain = false }) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  let current_hue = ((hue % 360) + 360) % 360
  let destroyed = false
  /** @type {{ x: number, y: number, w: number, h: number } | null | undefined} */
  let bounds // undefined = not computed; null = unavailable (fall back to fill)

  const img = new Image()
  img.src = `${base}/idle/${IDLE_DIR}.png`

  const draw = () => {
    if (destroyed || !img.complete || img.naturalWidth === 0) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = false // crisp pixel upscale
    ctx.filter = current_hue ? `hue-rotate(${current_hue}deg)` : 'none'
    if (contain) {
      if (bounds === undefined) bounds = opaque_bounds(img)
      if (bounds) {
        // scale the opaque box to fit the canvas (preserve aspect) and center it
        const scale = Math.min(
          canvas.width / bounds.w,
          canvas.height / bounds.h,
        )
        const dw = bounds.w * scale
        const dh = bounds.h * scale
        ctx.drawImage(
          img,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          (canvas.width - dw) / 2,
          (canvas.height - dh) / 2,
          dw,
          dh,
        )
        ctx.filter = 'none'
        return
      }
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.filter = 'none'
  }

  img.addEventListener('load', draw)
  if (img.complete) draw()

  return {
    set_hue: deg => {
      current_hue = ((deg % 360) + 360) % 360
      draw()
    },
    destroy: () => {
      destroyed = true
      img.removeEventListener('load', draw)
    },
  }
}
