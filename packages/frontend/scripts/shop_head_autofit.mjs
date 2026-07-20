// Per-hat camera auto-fit for the worn-cosmetic head renders. Framing history:
//   v1 — ONE tuned close-up constant (radius 2.4): tall hats poked out the top and were CLIPPED
//        (regression: tall hats were still half-clipped).
//   v2 — a bust-crop ZOOM ([shoulder … hat-top] filling the frame): read as an ultra-zoomed face crop
//        (regression: too tight — needed to move the camera away, not zoom in further).
//   v3 (this file) — REFRAME, not zoom: measure the model's real silhouette on a wide probe pass and fit
//        the WHOLE bounding box (avatar + hat) centered in frame with margin, at the same sane showcase
//        distance the cloak renders read at. Pixels stay the oracle (house law), so the fit rides the real
//        mount transform (bone parenting + height-normalisation) instead of re-deriving it.
//
// Camera model (worn_cosmetics_showcase.html): a level-ish camera at horizontal radius R, height camy,
// looking at (0, ty, 0), 48° vertical FOV, square canvas. For a point near the avatar's vertical axis the
// world height that maps to screen row `py` (0=top) at a level camera (camy≈ty) is:
//     worldY(py) = camy + R * TAN_HALF * (1 - 2*py/H)
// so worldY(0) = camy + R*TAN_HALF (frame top) and worldY(H) = camy - R*TAN_HALF (frame bottom).

import { inflateSync } from 'node:zlib'

const FOV_DEG = 48 // worn_cosmetics_showcase.html PerspectiveCamera vertical FOV
export const TAN_HALF = Math.tan((FOV_DEG / 2) * (Math.PI / 180))

// The probe pass: a deliberately WIDE, level framing that keeps the whole avatar + the tallest plausible
// hat inside the frame (no clipping) so the measured hat-top is real. camy==ty ⇒ the level-camera math above.
export const HEAD_PROBE = Object.freeze({ camera_radius: 4.0, camera_y: 1.8, target_y: 1.8 })

// Framing knobs. FILL = fraction of the frame the model's bounding box occupies (the rest is margin) —
// tuned to the cloak showcase's read (~0.68 of frame height for the full avatar). MIN_RADIUS floors the
// dolly at showcase distance so a short hat can never re-create the v2 face crop. MARGIN_PX = clip guard.
export const FILL = 0.68
export const MIN_RADIUS = 3.0
const MARGIN_PX_FRAC = 0.04

/**
 * Alpha-channel bounding box of a Playwright PNG screenshot buffer (8-bit RGBA, non-interlaced — the only
 * shape Playwright emits). Returns pixel bounds of every texel with alpha > `threshold`, or null if empty.
 * @param {Buffer} png @param {number} [threshold]
 * @returns {{ l:number, t:number, r:number, b:number, w:number, h:number } | null}
 */
export function alpha_bbox(png, threshold = 8) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG buffer')
  let width = 0
  let height = 0
  let bit_depth = 0
  let color_type = 0
  const idat = []
  let offset = 8
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bit_depth = body.readUInt8(8)
      color_type = body.readUInt8(9)
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bit_depth !== 8 || color_type !== 6)
    throw new Error(`unexpected PNG format depth=${bit_depth} color=${color_type}`)

  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4 // RGBA
  const stride = width * bpp
  const row = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  let l = width
  let t = height
  let r = -1
  let b = -1
  let src = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src]
    src += 1
    for (let i = 0; i < stride; i += 1) {
      const x_byte = raw[src + i]
      const a = i >= bpp ? row[i - bpp] : 0 // left
      const c = i >= bpp ? prev[i - bpp] : 0 // up-left
      const up = prev[i]
      let value
      switch (filter) {
        case 0:
          value = x_byte
          break
        case 1:
          value = x_byte + a
          break
        case 2:
          value = x_byte + up
          break
        case 3:
          value = x_byte + ((a + up) >> 1)
          break
        case 4: {
          const p = a + up - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - c)
          value = x_byte + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)
          break
        }
        default:
          throw new Error(`bad PNG filter ${filter}`)
      }
      row[i] = value & 0xff
    }
    src += stride
    for (let x = 0; x < width; x += 1) {
      if (row[x * bpp + 3] > threshold) {
        if (x < l) l = x
        if (x > r) r = x
        if (y < t) t = y
        if (y > b) b = y
      }
    }
    row.copy(prev)
  }
  if (r < 0) return null
  return { b, h: b - t + 1, l, r, t, w: r - l + 1 }
}

/**
 * Fit the head camera from a probe-pass alpha bbox: map the measured silhouette (whole avatar + hat) back
 * to world space and return the level camera that centers that ENTIRE box in frame at FILL, never closer
 * than MIN_RADIUS. Reframing, not zoom — position/distance move, the model never gets cropped into.
 * Keeps the caller's orbit/face/seek — only the dolly + vertical aim change.
 * @param {{ t:number, l:number, r:number, b:number }} bbox probe alpha bbox
 * @param {number} canvas probe render size in px (square)
 * @param {{ camera_radius:number, camera_y:number, target_y:number }} [probe]
 * @returns {{ camera_radius:number, camera_y:number, target_y:number }}
 */
export function head_fit_params(bbox, canvas, probe = HEAD_PROBE) {
  const world_y = (py) => probe.camera_y + probe.camera_radius * TAN_HALF * (1 - (2 * py) / canvas)
  const px_to_world = (2 * probe.camera_radius * TAN_HALF) / canvas // world units per probe pixel

  const box_top = world_y(bbox.t)
  const box_bottom = world_y(bbox.b + 1) // +1: b is the last opaque row (exclusive edge, mirrors width)
  const box_h = box_top - box_bottom
  const box_w = (bbox.r - bbox.l + 1) * px_to_world // measured silhouette width (avatar + hat)
  const center_y = (box_top + box_bottom) / 2

  const radius_v = box_h / (2 * FILL * TAN_HALF)
  const radius_h = box_w / (2 * FILL * TAN_HALF)
  const camera_radius = Math.max(MIN_RADIUS, radius_v, radius_h)
  return { camera_radius, camera_y: center_y, target_y: center_y }
}

/** Clip guard: does the final render leave margin on EVERY edge (the whole model visible)? */
export function within_margins(bbox, canvas) {
  if (!bbox) return false
  const m = Math.round(canvas * MARGIN_PX_FRAC)
  return bbox.t >= m && bbox.b <= canvas - m && bbox.l >= m && bbox.r <= canvas - m
}
