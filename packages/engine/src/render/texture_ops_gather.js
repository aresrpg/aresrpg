// GATHERABLE sprite OPS (ENGINE_AAA_PLAN §5 — rider 2 "beautiful sprites for wheats, ores, plants") — the
// three procedural shape ops for the job-content art system: wheat_sheaf (FARMER), ore_vein (MINER),
// herb_cluster (HERBALIST). SELF-CONTAINED BY DESIGN, exactly like texture_ops_flora.js: these import ONLY
// the pure noise/math helpers and define their own paint/over/ellipse/stroke, so the gather art is fully
// DECOUPLED from both the base baker ops and the flora ops — the atlas bakes all three sets without any of
// them being able to silently alter another's silhouette. The baker spreads GATHER_OPS into OP_TABLE (one
// wire-in line); every op shares the base op signature (buf,size,seed,layer,op[,vi,vc]).
//
// DETERMINISM LAW (§3.7): integer FNV/splitmix hashing only (hash01/value_noise_1d/fbm_field). Math.sin/cos
// /random are BANNED; radial facets use LITERAL unit-vector constants (compile-time numbers, not runtime
// trig). Every op paints OPAQUE texels (alpha 255) over a transparent background (alpha 0) — the baker's
// alpha-clip pass then RGB-dilates the cut edges, so ops never worry about edge fringing. `layer` (the
// destination atlas layer) folds into every hash ⇒ a recipe's `variants` decorrelate for free.
//
// RARITY GLOW (§5.1, no-white-halo law): a rare recipe passes `glow_rgb`; the op bakes the family's SIGNAL
// texels (wheat grains/awns, ore facet caps, herb cap/petal core) bright toward it. The soft SELF-glow is a
// modest per-block emission authored in texture_recipes_gather.js (BELOW the 2.05 bloom threshold at MEDIUM);
// the baked bright accent is what reads as luminous. Ops never touch emission — albedo only.

import { clamp, fbm_field, hash01, lerp, value_noise_1d } from './texture_noise.js'

// ── shared primitives (self-contained twins of the flora-op set; the decoupled-op idiom) ────────────────
/** Paint one texel solid at alpha 255 (bounds-checked). @param {Float32Array} buf @param {number} size
 *  @param {number} x @param {number} y @param {number} r @param {number} g @param {number} b */
function paint(buf, size, x, y, r, g, b) {
  if (x < 0 || x >= size || y < 0 || y >= size) return
  const i = (y * size + x) * 4
  buf[i] = clamp(r, 0, 255)
  buf[i + 1] = clamp(g, 0, 255)
  buf[i + 2] = clamp(b, 0, 255)
  buf[i + 3] = 255
}

/** Blend `w` toward (r,g,b) over an ALREADY-opaque texel (glow lift / rim shade); no-op on a transparent
 *  texel so it never leaks colour into the background. @param {Float32Array} buf @param {number} size
 *  @param {number} x @param {number} y @param {number} r @param {number} g @param {number} b @param {number} w */
function over(buf, size, x, y, r, g, b, w) {
  if (x < 0 || x >= size || y < 0 || y >= size) return
  const i = (y * size + x) * 4
  if (buf[i + 3] < 255) return
  buf[i] = clamp(lerp(buf[i], r, w), 0, 255)
  buf[i + 1] = clamp(lerp(buf[i + 1], g, w), 0, 255)
  buf[i + 2] = clamp(lerp(buf[i + 2], b, w), 0, 255)
}

/** Fill a solid ellipse (cx,cy) radii (rx,ry), shaded per-texel by fn(nx,ny)->[r,g,b] with (nx,ny) the
 *  normalised offset in [-1,1]. @param {Float32Array} buf @param {number} size @param {number} cx
 *  @param {number} cy @param {number} rx @param {number} ry @param {(nx:number,ny:number)=>number[]} fn */
function ellipse(buf, size, cx, cy, rx, ry, fn) {
  const x0 = Math.max(0, Math.floor(cx - rx)),
    x1 = Math.min(size - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry)),
    y1 = Math.min(size - 1, Math.ceil(cy + ry))
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const nx = (x - cx) / (rx || 1),
        ny = (y - cy) / (ry || 1)
      if (nx * nx + ny * ny > 1) continue
      const c = fn(nx, ny)
      paint(buf, size, x, y, c[0], c[1], c[2])
    }
  }
}

/** Thick line from (ax,ay) to (bx,by), half-width hw(t), colour col(t) (t along the line). @param
 *  {Float32Array} buf @param {number} size @param {number} ax @param {number} ay @param {number} bx
 *  @param {number} by @param {(t:number)=>number} hw @param {(t:number)=>number[]} col */
function stroke(buf, size, ax, ay, bx, by, hw, col) {
  const dx = bx - ax,
    dy = by - ay
  const len = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)))
  for (let s = 0; s <= len; s += 1) {
    const t = s / len
    const px = ax + dx * t,
      py = ay + dy * t
    const w = hw(t)
    const c = col(t)
    for (let oy = -Math.ceil(w); oy <= Math.ceil(w); oy += 1) {
      for (let ox = -Math.ceil(w); ox <= Math.ceil(w); ox += 1) {
        if (ox * ox + oy * oy > (w + 0.35) * (w + 0.35)) continue
        paint(buf, size, Math.round(px + ox), Math.round(py + oy), c[0], c[1], c[2])
      }
    }
  }
}

// ── WHEAT_SHEAF — a stand of many THIN grain stalks in the GRASS-BLADE idiom (mirrors the base baker's
// op_blades), each capped by a SMALL COMPACT ear (a few-px denser cluster, NOT a wide fanning canopy) so the
// sheaf reads as INDIVIDUAL thin stalks with clear gaps between them — thin wheat branches that don't
// visually melt together. Stalks are BOTTOM-ANCHORED (grown from the
// last row up) so the frontend's vertical row-flip lands the base on the quad's bottom edge, exactly like the
// grass sprites. Stalk = op.rgb (dark base → body); ear = head_rgb shading to a bright head_hi cap + a 1px awn
// glint at the apex; rares lift the ear toward glow_rgb. Reads as wheat at 64px sprite AND gather distance.
// DETERMINISM LAW (§3.7): integer FNV hashing only (hash01), no trig; every texel opaque over a transparent bg.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_wheat_sheaf(buf, size, seed, layer, op) {
  const stalk = op.rgb ?? [150, 158, 96]
  const stalk_dark = op.stalk_dark_rgb ?? [104, 112, 66]
  const head = op.head_rgb ?? [214, 178, 96]
  const head_hi = op.head_hi_rgb ?? [238, 208, 138]
  const tip = op.awn_rgb ?? head_hi
  const glow = op.glow_rgb ?? null
  const count = op.count ?? 13 // many thin stalks (grass-blade density) → reads as individuals, not one sheaf
  const min_h = op.min_h ?? 0.56 // wheat is TALL — stalks fill 0.56–0.90 of the tile
  const span_h = op.span_h ?? 0.34
  const ear_frac = op.ear_len ?? 0.16 // ear length as a fraction of the stalk height (compact — no wide splay)
  for (let b = 0; b < count; b += 1) {
    const base_x = (0.07 + hash01(b, seed, layer, 200) * 0.86) * (size - 1) // spread across the width, thin margin
    const height = Math.floor(size * (min_h + hash01(b, seed, layer, 201) * span_h))
    const lean = (hash01(b, seed, layer, 202) * 2 - 1) * size * 0.05 // gentle lean — wheat stands straighter than grass
    const tint = 0.84 + hash01(b, seed, layer, 203) * 0.3
    const half = 0.8 + hash01(b, seed, layer, 204) * 0.6 // THIN stalk (0.8–1.4px half-width; the op_blades idiom)
    const ear_px = Math.max(4, Math.round(height * ear_frac)) // compact ear length in px
    const stem_top = Math.max(1, height - ear_px) // the shaft ends where the ear begins
    // stalk shaft — thin, slightly tapered, dark at the ground fading to the body colour up the stem
    for (let yy = 0; yy < stem_top; yy += 1) {
      const t = yy / height
      const cx = base_x + lean * t,
        py = size - 1 - yy,
        hw = half * (1 - 0.25 * t)
      const k = Math.min(1, yy / (height * 0.4)) // base-dark → body over the lowest 40%
      const cr = lerp(stalk_dark[0], stalk[0], k),
        cg = lerp(stalk_dark[1], stalk[1], k),
        cb = lerp(stalk_dark[2], stalk[2], k)
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx += 1) {
        if (Math.abs(dx) > hw + 0.001) continue
        paint(buf, size, Math.round(cx + dx), py, cr * tint, cg * tint, cb * tint)
      }
    }
    // ear head — a small compact grain cluster: slightly WIDER than the stalk, tapering to a point, head_rgb
    // shading to a bright head_hi cap. A distinct little head per stalk — never a merged canopy.
    const ear_half = half + 1.1
    for (let yy = stem_top; yy <= height; yy += 1) {
      const et = (yy - stem_top) / Math.max(1, ear_px) // 0 at the ear base → 1 at the tip
      const t = yy / height,
        cx = base_x + lean * t,
        py = size - 1 - yy,
        hw = ear_half * (1 - 0.72 * et) // fat base → pointed tip
      const cr = lerp(head[0], head_hi[0], et),
        cg = lerp(head[1], head_hi[1], et),
        cb = lerp(head[2], head_hi[2], et)
      for (let dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx += 1) {
        if (Math.abs(dx) > hw + 0.001) continue
        paint(buf, size, Math.round(cx + dx), py, cr * tint, cg * tint, cb * tint)
      }
      if (glow) over(buf, size, Math.round(cx), py, glow[0], glow[1], glow[2], 0.5) // rare accent up the ear column
    }
    // a 1px awn glint at the very apex (the seed-head sparkle — not a splayed bristle canopy)
    over(buf, size, Math.round(base_x + lean), size - 1 - height, tip[0], tip[1], tip[2], 0.65)
  }
}

// ── ORE_VEIN — a rounded rock knuckle half-buried at the base, studded with crystalline FACETS (angular
// diamonds from literal unit vectors) whose bright caps (glint_rgb) carry the mineral colour + rare glow.
const FACET_DIRS = [
  [0, -1],
  [0.71, -0.71],
  [0.71, 0.71],
  [-0.71, 0.71],
  [-0.71, -0.71],
  [0.92, 0],
  [-0.92, 0],
]
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_ore_vein(buf, size, seed, layer, op) {
  const rock = op.rock_rgb ?? [96, 92, 88]
  const rock_dark = op.rock_dark_rgb ?? [58, 55, 52]
  const vein = op.rgb ?? [180, 200, 220] // the mineral colour (the family identity)
  const vein_dark = op.vein_dark_rgb ?? [110, 128, 150]
  const glint = op.glint_rgb ?? [236, 244, 252]
  const glow = op.glow_rgb ?? null
  const facets = op.facets ?? 5
  const cx = size / 2
  const cy = size * 0.66 // rock sits low, half-buried
  const rx = size * 0.42,
    ry = size * 0.34
  const shade = fbm_field(size, 4, 3, seed, layer, 210)
  // rock knuckle — a shaded dome, darker underside, lit crown
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - cx) / rx,
        ny = (y - cy) / ry
      const r2 = nx * nx + ny * ny
      if (r2 > 1 || y > cy + ry) continue
      const lit = clamp(1 - (ny + 0.15) * 0.55, 0.62, 1.18) // top lit, base dark
      const s = 0.9 + shade[y * size + x] * 0.2
      paint(
        buf,
        size,
        x,
        y,
        lerp(rock_dark[0], rock[0], lit) * s,
        lerp(rock_dark[1], rock[1], lit) * s,
        lerp(rock_dark[2], rock[2], lit) * s
      )
    }
  }
  // crystalline facets — angular diamonds emerging from the rock crown, one per hashed direction
  for (let f = 0; f < facets && f < FACET_DIRS.length; f += 1) {
    const [ux, uy] = FACET_DIRS[f]
    const dist = (0.24 + hash01(f, seed, layer, 211) * 0.4) * size * 0.5
    const fx = cx + ux * rx * 0.7,
      fy = cy - size * 0.06 + uy * ry * 0.55
    const fr = (0.09 + hash01(f, seed, layer, 212) * 0.07) * size
    const tx = fx + ux * dist * 0.5,
      ty = fy + uy * dist * 0.5 - size * 0.04
    // facet body — a slim diamond (tapered stroke) of the mineral colour, dark→bright toward the tip
    stroke(
      buf,
      size,
      fx,
      fy,
      tx,
      ty,
      (t) => Math.max(1, fr * (1 - t)),
      (t) => [lerp(vein_dark[0], vein[0], t), lerp(vein_dark[1], vein[1], t), lerp(vein_dark[2], vein[2], t)]
    )
    // glint cap — a bright chip at the facet tip
    ellipse(buf, size, tx, ty, fr * 0.5, fr * 0.5, () => glint)
    if (glow) over(buf, size, Math.round(tx), Math.round(ty), glow[0], glow[1], glow[2], 0.6)
  }
}

// ── HERB_CLUSTER — the compositor for the diverse herbalist roster. A `shape` param selects the silhouette:
// shroom (fungus), orchid (petal bloom), aloe (spiky rosette), truffle (subterranean mound), spore
// (drifting cloud). Most herbs are one shape + the family palette (§5.1: "existing atoms with new palettes");
// truffle/spore are the genuinely-new shapes. Rare recipes pass glow_rgb → the cap/petal/spore core lifts.
const ALOE_DIRS = [
  [0, -1],
  [0.5, -0.87],
  [0.87, -0.5],
  [0.87, 0.5],
  [-0.5, -0.87],
  [-0.87, -0.5],
  [-0.87, 0.5],
]
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_herb_cluster(buf, size, seed, layer, op) {
  const shape = op.shape ?? 'shroom'
  const rgb = op.rgb ?? [150, 176, 96] // the herb identity colour
  const glow = op.glow_rgb ?? null
  if (shape === 'orchid') {
    const stem = op.stem_rgb ?? [72, 116, 56]
    const petal = op.petal_rgb ?? rgb
    const eye = op.eye_rgb ?? [244, 232, 176]
    const radius = op.radius ?? size * 0.14
    const cx = size / 2,
      cy = size * 0.34
    for (let y = Math.floor(cy); y < size; y += 1)
      for (let dx = -1; dx <= 1; dx += 1) paint(buf, size, cx + dx, y, stem[0], stem[1], stem[2])
    const RING = [
      [0, -1],
      [0.87, -0.5],
      [0.87, 0.5],
      [0, 1],
      [-0.87, 0.5],
      [-0.87, -0.5],
    ]
    for (const [ux, uy] of RING)
      ellipse(buf, size, cx + ux * radius * 0.95, cy + uy * radius * 0.95, radius * 0.6, radius * 0.6, () => petal)
    ellipse(buf, size, cx, cy, radius, radius, (nx, ny) => {
      const k = 1 - 0.2 * (nx * nx + ny * ny)
      return [rgb[0] * k, rgb[1] * k, rgb[2] * k]
    })
    ellipse(buf, size, cx, cy, radius * 0.36, radius * 0.36, () => eye)
    if (glow) ellipse(buf, size, cx, cy, radius * 0.5, radius * 0.5, () => glow)
  } else if (shape === 'aloe') {
    const dark = op.rgb_dark ?? [56, 110, 92]
    const cx = size / 2,
      cy = size * 0.9
    for (const [ux, uy] of ALOE_DIRS) {
      // thick pointed leaves radiating from the base
      const len = size * (0.5 + hash01(ux * 10 + uy, seed, layer, 220) * 0.18)
      stroke(
        buf,
        size,
        cx,
        cy,
        cx + ux * len,
        cy + uy * len,
        (t) => Math.max(1, size * 0.06 * (1 - t)),
        (t) => [lerp(dark[0], rgb[0], 1 - t), lerp(dark[1], rgb[1], 1 - t), lerp(dark[2], rgb[2], 1 - t)]
      )
    }
    ellipse(buf, size, cx, cy - size * 0.04, size * 0.12, size * 0.08, () => dark) // core rosette
    if (glow)
      for (const [ux, uy] of ALOE_DIRS)
        over(
          buf,
          size,
          Math.round(cx + ux * size * 0.5),
          Math.round(cy + uy * size * 0.5),
          glow[0],
          glow[1],
          glow[2],
          0.45
        )
  } else if (shape === 'truffle') {
    const dark = op.rgb_dark ?? [58, 30, 34]
    const wart = op.wart_rgb ?? [96, 48, 54]
    const shade = fbm_field(size, 5, 3, seed, layer, 221)
    const cx = size / 2,
      cy = size * 0.6
    for (let m = 0; m < 3; m += 1) {
      // lumpy fused mound of tubers
      const mx = cx + (hash01(m, seed, layer, 222) * 2 - 1) * size * 0.16
      const my = cy + (hash01(m, seed, layer, 223) * 2 - 1) * size * 0.1
      const mr = size * (0.2 + hash01(m, seed, layer, 224) * 0.1)
      ellipse(buf, size, mx, my, mr * 1.15, mr, (nx, ny) => {
        const lit = clamp(1 - (ny + 0.1) * 0.5, 0.6, 1.15)
        return [lerp(dark[0], rgb[0], lit), lerp(dark[1], rgb[1], lit), lerp(dark[2], rgb[2], lit)]
      })
    }
    for (let s = 0; s < 40; s += 1) {
      // warty pit speckle
      const sx = cx + (hash01(s, seed, layer, 225) * 2 - 1) * size * 0.3
      const sy = cy + (hash01(s, seed, layer, 226) * 2 - 1) * size * 0.22
      if (
        shade[
          Math.max(0, Math.min(size - 1, Math.round(sy))) * size + Math.max(0, Math.min(size - 1, Math.round(sx)))
        ] > 0.5
      )
        over(buf, size, Math.round(sx), Math.round(sy), wart[0], wart[1], wart[2], 0.7)
    }
    if (glow) ellipse(buf, size, cx, cy, size * 0.1, size * 0.08, () => glow)
  } else if (shape === 'spore') {
    const pale = op.rgb_light ?? [lerp(rgb[0], 255, 0.4), lerp(rgb[1], 255, 0.4), lerp(rgb[2], 255, 0.4)]
    const cx = size / 2,
      cy = size * 0.5
    // a soft drifting cloud of translucent-reading puffs (pale, low-contrast) + a few bright motes
    for (let p = 0; p < 22; p += 1) {
      const px = cx + (hash01(p, seed, layer, 230) * 2 - 1) * size * 0.36
      const py = cy + (hash01(p, seed, layer, 231) * 2 - 1) * size * 0.4
      const pr = size * (0.03 + hash01(p, seed, layer, 232) * 0.05)
      const k = 0.7 + hash01(p, seed, layer, 233) * 0.3
      ellipse(buf, size, px, py, pr, pr, () => [
        lerp(rgb[0], pale[0], k),
        lerp(rgb[1], pale[1], k),
        lerp(rgb[2], pale[2], k),
      ])
      if (glow && hash01(p, seed, layer, 234) > 0.6)
        over(buf, size, Math.round(px), Math.round(py), glow[0], glow[1], glow[2], 0.6)
    }
  } else {
    // 'shroom' — stem + domed cap(s) + pale spots (fungus)
    const cap = rgb
    const cap_dark = op.rgb_dark ?? [rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6]
    const stem = op.stem_rgb ?? [222, 210, 186]
    const spot = op.spot_rgb ?? [240, 234, 214]
    const count = op.count ?? 3
    for (let m = 0; m < count; m += 1) {
      const cx = (0.24 + hash01(m, seed, layer, 240) * 0.52) * size
      const h = (0.34 + hash01(m, seed, layer, 241) * 0.3) * size
      const cr = (0.11 + hash01(m, seed, layer, 242) * 0.08) * size
      const cap_y = size - 1 - h
      stroke(
        buf,
        size,
        cx,
        size - 1,
        cx,
        cap_y + cr * 0.4,
        () => Math.max(1, cr * 0.36),
        () => stem
      )
      ellipse(buf, size, cx, cap_y, cr, cr * 0.82, (nx, ny) =>
        ny > 0.18
          ? [-1, 0, 0]
          : [
              lerp(cap_dark[0], cap[0], 1 - Math.abs(nx)),
              lerp(cap_dark[1], cap[1], 1 - Math.abs(nx)),
              lerp(cap_dark[2], cap[2], 1 - Math.abs(nx)),
            ]
      )
      for (let s = 0; s < 3; s += 1)
        over(
          buf,
          size,
          Math.round(cx + (hash01(m, s, layer, 243) * 2 - 1) * cr * 0.6),
          Math.round(cap_y - hash01(m, s, layer, 244) * cr * 0.5),
          spot[0],
          spot[1],
          spot[2],
          0.85
        )
      if (glow) ellipse(buf, size, cx, cap_y, cr * 0.55, cr * 0.45, () => glow)
    }
  }
  // silhouette tooth — a faint per-texel grain over opaque body (kills flat plastic read)
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      if (buf[i + 3] === 255) {
        const g = 0.94 + value_noise_1d(x + y, size, 10, seed, layer, 250) * 0.12
        buf[i] *= g
        buf[i + 1] *= g
        buf[i + 2] *= g
      }
    }
}

/** The gatherable sprite op set — spread into the baker's OP_TABLE (one wire-in line). Names are disjoint
 *  from every base + flora op. @type {Record<string, (buf: Float32Array, size: number, seed: number, layer: number, op: any, vi?: number, vc?: number) => void>} */
export const GATHER_OPS = {
  wheat_sheaf: op_wheat_sheaf,
  ore_vein: op_ore_vein,
  herb_cluster: op_herb_cluster,
}
