// VIVID-WORLD flora sprite OPS (2026-07-07) — the procedural shape ops for the new clutter-sprite roster
// (bush, branch, pebbles, mushroom, shell, starfish, cattail, lilypad + self-contained stalk/bloom
// primitives). SELF-CONTAINED BY DESIGN: these import ONLY the pure noise/math helpers from
// texture_noise.js and define their own `paint`, so the flora sprite art is fully DECOUPLED from the base
// baker's recipe ops — the atlas can bake these without any change to base recipe behaviour, and a future
// base-op tweak can never silently alter a flora silhouette. The baker spreads FLORA_OPS into its OP_TABLE
// (one wire-in line); every op shares the base op signature (buf,size,seed,layer,op[,vi,vc]).
//
// DETERMINISM LAW (§3.7): integer FNV/splitmix hashing only (hash01/value_noise_1d/fbm_field). Math.sin/cos
// /random are BANNED; radial shapes use LITERAL unit-vector constants (compile-time numbers, not runtime
// trig). Every op paints OPAQUE texels (alpha 255) over a transparent background (alpha 0) — the baker's
// alpha-clip pass then RGB-dilates the cut edges, so ops need not worry about edge fringing. `layer` (the
// destination atlas layer) folds into every hash ⇒ a recipe's `variants` decorrelate for free.

import { clamp, fbm_field, hash01, lerp, value_noise_1d } from './texture_noise.js'

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

/** Blend `w` toward (r,g,b) over an ALREADY-opaque texel (frost dust / rim shade / highlights); no-op on a
 *  transparent texel so it never leaks colour into the background. @param {Float32Array} buf @param {number}
 *  size @param {number} x @param {number} y @param {number} r @param {number} g @param {number} b @param {number} w */
function over(buf, size, x, y, r, g, b, w) {
  if (x < 0 || x >= size || y < 0 || y >= size) return
  const i = (y * size + x) * 4
  if (buf[i + 3] < 255) return
  buf[i] = clamp(lerp(buf[i], r, w), 0, 255)
  buf[i + 1] = clamp(lerp(buf[i + 1], g, w), 0, 255)
  buf[i + 2] = clamp(lerp(buf[i + 2], b, w), 0, 255)
}

/** Fill a solid ellipse (cx,cy) radii (rx,ry) with a colour shaded per-texel by fn(nx,ny)->[r,g,b] where
 *  (nx,ny) is the normalised offset in [-1,1]. @param {Float32Array} buf @param {number} size @param {number}
 *  cx @param {number} cy @param {number} rx @param {number} ry @param {(nx:number,ny:number)=>number[]} fn */
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

/** Thick line from (ax,ay) to (bx,by), half-width `hw`(t) (t along the line), colour fn(t). @param {Float32Array}
 *  buf @param {number} size @param {number} ax @param {number} ay @param {number} bx @param {number} by
 *  @param {(t:number)=>number} hw @param {(t:number)=>number[]} col */
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

// ── STALKS — tapered vertical blades (grass / reed / weed / young shoot / lavender / thistle / seaweed).
// A self-contained twin of the base `blades` op: each blade hashed for x-position, height, width, lean and
// a per-blade brightness; an optional per-blade tip gradient (rgb→tip above `tip_start`, graduated across
// variants) paints sun-bleached / seed-head / purple-bloom tops. Bottom-anchored (grows up from the last row).
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op @param {number} [vi] @param {number} [vc] */
function op_stalks(buf, size, seed, layer, op, vi = 0, vc = 1) {
  const count = op.count ?? 8
  const rgb = op.rgb ?? [96, 152, 72]
  const min_h = op.min_h ?? 0.45
  const span_h = op.span_h ?? 0.45
  const spread = op.spread ?? 1
  const lean_amp = op.lean ?? 0.18
  const tip = op.tip_rgb ?? null
  const tip2 = op.tip_rgb2 ?? null
  const tip_start = op.tip_start ?? 0.45
  const dryness = vc > 1 ? vi / (vc - 1) : 1
  for (let b = 0; b < count; b += 1) {
    const base_x = hash01(b, seed, layer, 20) * (size - 1)
    const height = Math.floor(size * (min_h + hash01(b, seed, layer, 21) * span_h))
    const base_half = (1 + hash01(b, seed, layer, 22) * 1.5) * spread
    const lean = (hash01(b, seed, layer, 23) * 2 - 1) * size * lean_amp
    const tint = 0.82 + hash01(b, seed, layer, 24) * 0.32
    const tmix = tip2 ? hash01(b, seed, layer, 25) : 0
    const btip = tip
      ? [
          lerp(tip[0], tip2?.[0] ?? tip[0], tmix),
          lerp(tip[1], tip2?.[1] ?? tip[1], tmix),
          lerp(tip[2], tip2?.[2] ?? tip[2], tmix),
        ]
      : null
    for (let yy = 0; yy < height; yy += 1) {
      const t = yy / height
      const half = base_half * (1 - t)
      const cx = base_x + lean * t
      const py = size - 1 - yy
      let [cr, cg, cb] = rgb
      if (btip && dryness > 0) {
        const k = (t <= tip_start ? 0 : (t - tip_start) / (1 - tip_start)) * dryness
        cr = lerp(rgb[0], btip[0], k)
        cg = lerp(rgb[1], btip[1], k)
        cb = lerp(rgb[2], btip[2], k)
      }
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx += 1) {
        if (Math.abs(dx) > half + 0.001) continue
        paint(buf, size, Math.round(cx + dx), py, cr * tint, cg * tint, cb * tint)
      }
    }
  }
}

// ── BLOOM — a small flowering plant: a centred stem + a round dappled head, with an optional ring of petal
// lobes. Self-contained twin of the base `flower` op (orchid / alpine flower). Head sits in the upper third.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_bloom(buf, size, seed, layer, op) {
  const head = op.head_rgb ?? [200, 60, 60]
  const stem = op.stem_rgb ?? [70, 120, 55]
  const petal = op.petal_rgb ?? head
  const radius = op.radius ?? Math.round(size * 0.13)
  const petals = op.petals ?? 0
  const cx = Math.floor(size / 2)
  const head_cy = Math.floor(size * (op.head_y ?? 0.34))
  for (let y = head_cy; y < size; y += 1)
    for (let dx = -1; dx <= 1; dx += 1) paint(buf, size, cx + dx, y, stem[0], stem[1], stem[2])
  // petal lobes (literal unit vectors — no runtime trig): up to 6 around the head at radius·0.95.
  const RING = [
    [0, -1],
    [0.87, -0.5],
    [0.87, 0.5],
    [0, 1],
    [-0.87, 0.5],
    [-0.87, -0.5],
  ]
  for (let p = 0; p < petals && p < RING.length; p += 1) {
    const px = cx + RING[p][0] * radius * 0.95,
      py = head_cy + RING[p][1] * radius * 0.95
    ellipse(buf, size, px, py, radius * 0.55, radius * 0.55, () => petal)
  }
  ellipse(buf, size, cx, head_cy, radius, radius, (nx, ny) => {
    const k = 1 - 0.2 * (nx * nx + ny * ny)
    return [head[0] * k, head[1] * k, head[2] * k]
  })
  // pale centre eye
  ellipse(buf, size, cx, head_cy, radius * 0.34, radius * 0.34, () => op.eye_rgb ?? [246, 234, 180])
}

// ── BUSH — a rounded leafy shrub mass: an ellipse of dappled leaves (dark↔light tone field) with a
// noise-ragged, hole-punched edge (reads as foliage, not a card) over a short woody stem. Broadleaf worlds
// pass a bigger radius + fewer, larger dapple; jungle plants pass warm greens.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_bush(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [72, 108, 52]
  const dark = op.rgb_dark ?? [44, 72, 36]
  const light = op.rgb_light ?? [110, 146, 78]
  const stem = op.stem_rgb ?? [78, 58, 40]
  const hole = clamp(op.hole ?? 0.24, 0, 0.6)
  const cy = size * (op.cy ?? 0.58)
  const rx = size * (op.rx ?? 0.42),
    ry = size * (op.ry ?? 0.4)
  const cx = size / 2
  const tone = fbm_field(size, op.tone_freq ?? 5, 3, seed, layer, 80)
  const mask = fbm_field(size, op.leaf_freq ?? 6, 3, seed, layer, 81)
  // stem
  stroke(
    buf,
    size,
    cx,
    size - 1,
    cx,
    cy + ry * 0.5,
    () => Math.max(1, size * 0.02),
    () => stem
  )
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - cx) / rx,
        ny = (y - cy) / ry
      const r2 = nx * nx + ny * ny
      if (r2 > 1) continue
      // ragged hole-punched edge: erode with the leaf mask toward the rim.
      const erode = clamp((Math.sqrt(r2) - 0.5) / 0.5, 0, 1)
      if (mask[y * size + x] - erode * erode * 0.85 < hole) continue
      const t = tone[y * size + x]
      const g = 0.9 + hash01(x, y, seed, layer, 82) * 0.2
      paint(
        buf,
        size,
        x,
        y,
        lerp(dark[0], light[0], t) * g,
        lerp(dark[1], light[1], t) * g,
        lerp(dark[2], light[2], t) * g
      )
      if (mask[y * size + x] < hole + 0.06) over(buf, size, x, y, rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.55, 0.5) // inner-gap shade
    }
  }
}

// ── BRANCH — a bare woody twig: a leaning main stem from the ground + a couple of hashed forks; optional
// frost dusting on the upper texels (Everest frozen shrub) or a bleached grey (paradise driftwood).
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_branch(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [86, 62, 42]
  const dark = op.rgb_dark ?? [58, 42, 28]
  const forks = op.forks ?? 3
  const thick = (op.thick ?? 0.045) * size
  const frost = op.frost_rgb ?? null
  const cx = size / 2
  const col = (/** @type {number} */ t) => [
    lerp(rgb[0], dark[0], t * 0.6),
    lerp(rgb[1], dark[1], t * 0.6),
    lerp(rgb[2], dark[2], t * 0.6),
  ]
  const top_x = cx + (hash01(0, seed, layer, 90) * 2 - 1) * size * 0.16
  const top_y = size * (0.12 + hash01(1, seed, layer, 90) * 0.1)
  stroke(buf, size, cx, size - 1, top_x, top_y, (t) => thick * (1 - 0.6 * t), col)
  for (let f = 0; f < forks; f += 1) {
    const t = 0.28 + hash01(f, seed, layer, 91) * 0.5 // fork attach point up the stem
    const ax = lerp(cx, top_x, t),
      ay = lerp(size - 1, top_y, t)
    const dir = hash01(f, seed, layer, 92) < 0.5 ? -1 : 1
    const bx = ax + dir * size * (0.14 + hash01(f, seed, layer, 93) * 0.16)
    const by = ay - size * (0.12 + hash01(f, seed, layer, 94) * 0.16)
    stroke(buf, size, ax, ay, bx, by, (tt) => Math.max(0.8, thick * 0.7 * (1 - tt)), col)
  }
  if (frost)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) {
        const w =
          clamp((size * 0.55 - y) / (size * 0.55), 0, 1) * (0.35 + 0.5 * value_noise_1d(x, size, 8, seed, layer, 95))
        if (w > 0.05) over(buf, size, x, y, frost[0], frost[1], frost[2], clamp(w, 0, 0.8))
      }
}

// ── PEBBLES — a low cluster of rounded stones on the ground: hashed ellipses near the bottom, each with a
// lit top, a darker underside and a contact shadow. Fixed mineral greys (no biome tint) unless a world opts in.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_pebbles(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [128, 126, 122]
  const count = op.count ?? 5
  for (let s = 0; s < count; s += 1) {
    const cx = (0.16 + hash01(s, seed, layer, 100) * 0.68) * size
    const rr = (0.07 + hash01(s, seed, layer, 101) * 0.09) * size
    const cy = size - 1 - rr * 0.7 - hash01(s, seed, layer, 102) * size * 0.06
    const v = 0.82 + hash01(s, seed, layer, 103) * 0.34
    ellipse(buf, size, cx, cy, rr * 1.15, rr, (nx, ny) => {
      const lit = clamp(1 - (ny + 0.2) * 0.5, 0.6, 1.15) // top lit, underside dark
      return [rgb[0] * v * lit, rgb[1] * v * lit, rgb[2] * v * lit]
    })
  }
}

// ── MUSHROOM — a small cluster of toadstools: pale stems + domed caps (half-ellipse) with pale spots.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_mushroom(buf, size, seed, layer, op) {
  const cap = op.cap_rgb ?? [176, 66, 58]
  const stem = op.stem_rgb ?? [222, 210, 186]
  const spot = op.spot_rgb ?? [240, 234, 214]
  const count = op.count ?? 3
  for (let m = 0; m < count; m += 1) {
    const cx = (0.22 + hash01(m, seed, layer, 110) * 0.56) * size
    const h = (0.34 + hash01(m, seed, layer, 111) * 0.28) * size
    const cr = (0.09 + hash01(m, seed, layer, 112) * 0.06) * size
    const cap_y = size - 1 - h
    stroke(
      buf,
      size,
      cx,
      size - 1,
      cx,
      cap_y + cr * 0.4,
      () => Math.max(1, cr * 0.34),
      () => stem
    )
    // dome cap = top half of an ellipse
    ellipse(buf, size, cx, cap_y, cr, cr * 0.85, (nx, ny) =>
      ny > 0.15 ? [-1, 0, 0] : [cap[0] * (1 - 0.18 * nx * nx), cap[1], cap[2]]
    )
    // spots
    for (let s = 0; s < 3; s += 1) {
      const sx = cx + (hash01(m, s, layer, 113) * 2 - 1) * cr * 0.6
      const sy = cap_y - hash01(m, s, layer, 114) * cr * 0.5
      over(buf, size, Math.round(sx), Math.round(sy), spot[0], spot[1], spot[2], 0.9)
    }
  }
}

// ── SHELL — a scallop seashell: a bottom-anchored fan (semi-ellipse) with radial ridge shading + a darker
// hinge at the base. Pale cream/pink; fixed colour (a shell shouldn't take grass tint).
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_shell(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [232, 206, 194]
  const ridge = op.ridge_rgb ?? [198, 160, 150]
  const cx = size / 2
  const cy = size * 0.9 // hinge near the bottom
  const rx = size * 0.4,
    ry = size * 0.62
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - cx) / rx,
        ny = (y - cy) / ry
      if (ny > 0 || nx * nx + ny * ny > 1) continue // upper semi-ellipse only
      // radial ridges: bands in the fan angle proxy (nx / -ny) via value noise on the horizontal offset.
      const band = value_noise_1d(Math.round((nx / (-ny + 0.15)) * size * 0.5 + size), size, 10, seed, layer, 120)
      const shade = 0.72 + 0.28 * band
      const rim = clamp(1 - (1 - Math.sqrt(nx * nx + ny * ny)) / 0.12, 0, 1) // darken toward the shell rim
      paint(
        buf,
        size,
        x,
        y,
        lerp(rgb[0], ridge[0], 1 - shade + rim * 0.4),
        lerp(rgb[1], ridge[1], 1 - shade + rim * 0.4),
        lerp(rgb[2], ridge[2], 1 - shade + rim * 0.4)
      )
    }
  }
  ellipse(buf, size, cx, cy, rx * 0.22, ry * 0.1, () => ridge) // hinge knob
}

// ── STARFISH — a 5-armed star from the centre (five LITERAL unit vectors, 72° apart — compile-time
// constants, no runtime trig). Each arm a tapered stroke; a filled core; lighter centre + speckle. Fixed tan.
const STAR_ARMS = [
  [0, -1],
  [0.951, -0.309],
  [0.588, 0.809],
  [-0.588, 0.809],
  [-0.951, -0.309],
]
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_starfish(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [224, 150, 84]
  const light = op.rgb_light ?? [244, 196, 140]
  const cx = size / 2,
    cy = size * 0.54
  const arm = size * 0.42
  const col = (/** @type {number} */ t) => [
    lerp(light[0], rgb[0], t),
    lerp(light[1], rgb[1], t),
    lerp(light[2], rgb[2], t),
  ]
  ellipse(buf, size, cx, cy, size * 0.16, size * 0.16, () => rgb) // core
  for (const [ux, uy] of STAR_ARMS)
    stroke(buf, size, cx, cy, cx + ux * arm, cy + uy * arm, (t) => Math.max(0.8, size * 0.11 * (1 - t)), col)
  ellipse(buf, size, cx, cy, size * 0.09, size * 0.09, () => light) // lit centre
  for (let s = 0; s < 20; s += 1) {
    // tube-foot speckle
    const a = STAR_ARMS[s % 5]
    const t = hash01(s, seed, layer, 130)
    over(buf, size, Math.round(cx + a[0] * arm * t), Math.round(cy + a[1] * arm * t), light[0], light[1], light[2], 0.5)
  }
}

// ── CATTAIL — marsh reed: a few tall narrow stalks + a brown cylindrical seed-spike on the central stalk.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_cattail(buf, size, seed, layer, op) {
  const stalk = op.stalk_rgb ?? [92, 132, 70]
  const spike = op.spike_rgb ?? [104, 70, 40]
  const spike_hi = op.spike_hi_rgb ?? [140, 100, 62]
  op_stalks(buf, size, seed, layer, {
    count: op.count ?? 4,
    rgb: stalk,
    min_h: 0.7,
    span_h: 0.28,
    spread: 0.55,
    lean: 0.06,
  })
  // spike on the central stalk, upper third
  const cx = Math.round(size * 0.5)
  const sy0 = size * 0.2,
    sy1 = size * 0.45,
    sw = Math.max(2, size * 0.055)
  for (let y = Math.floor(sy0); y <= Math.ceil(sy1); y += 1) {
    for (let dx = -Math.ceil(sw); dx <= Math.ceil(sw); dx += 1) {
      if (Math.abs(dx) > sw) continue
      const lit = 1 - (Math.abs(dx) / sw) * 0.4
      paint(
        buf,
        size,
        cx + dx,
        y,
        lerp(spike[0], spike_hi[0], 1 - Math.abs(dx) / sw) * lit,
        spike[1] * lit,
        spike[2] * lit
      )
    }
  }
}

// ── LILYPAD — a flat round pad (art-only until the underwater/floating emission path exists): a wide
// ellipse with the classic wedge notch cut, a darker rim and veins radiating from the notch.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_lilypad(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [86, 138, 66]
  const dark = op.rgb_dark ?? [56, 100, 46]
  const vein = op.vein_rgb ?? [44, 82, 40]
  const cx = size / 2,
    cy = size * 0.62
  const rx = size * 0.46,
    ry = size * 0.34
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x - cx) / rx,
        ny = (y - cy) / ry
      const r2 = nx * nx + ny * ny
      if (r2 > 1) continue
      // wedge notch: a narrow sector opening downward (nx≈0, ny>0) is cut out.
      if (ny > 0 && Math.abs(nx) < 0.16 * (1 + ny)) continue
      const rr = Math.sqrt(r2)
      const rim = clamp((rr - 0.78) / 0.22, 0, 1)
      const g = 0.92 + hash01(x, y, seed, layer, 140) * 0.16
      paint(
        buf,
        size,
        x,
        y,
        lerp(rgb[0], dark[0], rim) * g,
        lerp(rgb[1], dark[1], rim) * g,
        lerp(rgb[2], dark[2], rim) * g
      )
    }
  }
  // radial veins from the notch centre
  for (let v = 0; v < 7; v += 1) {
    const ang = STAR_ARMS[v % 5]
    stroke(
      buf,
      size,
      cx,
      cy,
      cx + ang[0] * rx * 0.92,
      cy + ang[1] * ry * 0.92,
      () => Math.max(0.6, size * 0.012),
      () => vein
    )
  }
}

// ── NEEDLE_SPRAY — a conifer needle bunch (pine/spruce sprite crown + needled twig cards, §3.7 "conifer
// needle bunch"): a few drooping branchlets fan DOWN-and-out from an upper attach, each lined with short
// herringbone needle pairs that sag toward the ground. Reads spiky/needled — distinct from op_leaf's round
// puff. Alpha-clip (needles paint OPAQUE over the transparent bg). Rib directions are LITERAL down-fan
// unit vectors (compile-time constants — no runtime trig, §3.7 determinism law).
const NEEDLE_FAN = [
  [-0.6, 0.8],
  [-0.38, 0.92],
  [-0.18, 0.98],
  [0, 1],
  [0.18, 0.98],
  [0.38, 0.92],
  [0.6, 0.8],
]
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_needle_spray(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [44, 78, 60] // dark needle base
  const light = op.rgb_light ?? [82, 116, 92] // sun-lit needle tip
  const stem = op.stem_rgb ?? [58, 46, 34]
  const count = op.count ?? 7
  const needle = (op.needle_len ?? 0.12) * size
  const ax = size * 0.5,
    ay = size * 0.16 // attach near the top-centre
  for (let s = 0; s < count; s += 1) {
    const dir = NEEDLE_FAN[s % NEEDLE_FAN.length]
    const bx = ax + (hash01(s, seed, layer, 200) * 2 - 1) * size * 0.14 // scatter the rib bases
    const by = ay + hash01(s, seed, layer, 201) * size * 0.1
    const len = size * (0.5 + hash01(s, seed, layer, 202) * 0.32)
    const ex = bx + dir[0] * len,
      ey = by + dir[1] * len
    stroke(
      buf,
      size,
      bx,
      by,
      ex,
      ey,
      () => Math.max(0.7, size * 0.012),
      () => stem
    ) // rib
    const perp = [dir[1], -dir[0]] // 90° rotate (pure swap/negate — no trig)
    const K = 9
    for (let k = 1; k <= K; k += 1) {
      const t = k / (K + 1)
      const px = bx + (ex - bx) * t,
        py = by + (ey - by) * t
      const nl = needle * (1 - 0.5 * t) // needles shorten toward the tip
      const tint = 0.85 + hash01(s * 13 + k, seed, layer, 203) * 0.3
      const col = (/** @type {number} */ tt) => [
        lerp(rgb[0], light[0], tt) * tint,
        lerp(rgb[1], light[1], tt) * tint,
        lerp(rgb[2], light[2], tt) * tint,
      ]
      const hw = (/** @type {number} */ tt) => Math.max(0.5, 0.9 * (1 - tt))
      stroke(buf, size, px, py, px + perp[0] * nl, py + perp[1] * nl + nl * 0.7, hw, col) // droop out-and-down
      stroke(buf, size, px, py, px - perp[0] * nl, py - perp[1] * nl + nl * 0.7, hw, col)
    }
  }
}

// ── FROND — a palm frond rosette (palm crown card, §3.4 palm_curve "frond rosette (card-only crown)"):
// several long PINNATE fronds arc up-and-out from a bottom-centre base then sag under gravity (parabolic,
// no trig), each a rachis lined with leaflet ticks that shorten toward the tip. Alpha-clip. Literal UP-fan
// unit vectors launch each frond.
const FROND_FAN = [
  [-0.86, -0.52],
  [-0.6, -0.8],
  [-0.3, -0.95],
  [0, -1],
  [0.3, -0.95],
  [0.6, -0.8],
  [0.86, -0.52],
]
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_frond(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [112, 124, 40] // frond leaflet
  const dark = op.rgb_dark ?? [74, 84, 26] // rachis
  const light = op.rgb_light ?? [150, 158, 64] // sun-lit leaflet
  const count = op.count ?? 7
  const bx = size * 0.5,
    by = size * 0.9 // crown base, bottom-centre
  for (let f = 0; f < count; f += 1) {
    const dir = FROND_FAN[f % FROND_FAN.length]
    const len = size * (0.62 + hash01(f, seed, layer, 210) * 0.28)
    const droop = size * (0.28 + hash01(f, seed, layer, 211) * 0.22) // parabolic gravity pull at the tip
    const STEPS = 22
    let px = bx,
      py = by
    for (let st = 1; st <= STEPS; st += 1) {
      const t = st / STEPS
      const nx = bx + dir[0] * len * t
      const ny = by + dir[1] * len * t + droop * t * t // launch up-out, sag down at the tip
      stroke(
        buf,
        size,
        px,
        py,
        nx,
        ny,
        () => Math.max(0.7, size * 0.016 * (1 - 0.6 * t)),
        () => dark
      ) // rachis
      const perp = [ny - py, -(nx - px)]
      const plen = Math.hypot(perp[0], perp[1]) || 1
      const ux = perp[0] / plen,
        uy = perp[1] / plen
      const ll = size * 0.1 * (1 - 0.7 * t) // leaflets shorten toward the tip
      const tint = 0.85 + hash01(f * 17 + st, seed, layer, 212) * 0.3
      const col = () => [rgb[0] * tint, rgb[1] * tint, rgb[2] * tint]
      const colL = () => [light[0] * tint, light[1] * tint, light[2] * tint]
      stroke(buf, size, nx, ny, nx + ux * ll, ny + uy * ll, () => 0.6, st % 2 ? col : colL)
      stroke(buf, size, nx, ny, nx - ux * ll, ny - uy * ll, () => 0.6, st % 2 ? colL : col)
      px = nx
      py = ny
    }
  }
}

// ── MOSS_DRAPE — hanging swamp moss (swamp_buttress draped crown card, §3.7 "swamp moss drape"): TOP-
// anchored strands droop down with a per-row horizontal wander (integrated value noise) and thinning,
// murky grey-green, lighter at the canopy line. Sparse gaps read as drapey Spanish moss. Alpha-clip.
/** @param {Float32Array} buf @param {number} size @param {number} seed @param {number} layer @param {any} op */
function op_moss_drape(buf, size, seed, layer, op) {
  const rgb = op.rgb ?? [72, 86, 56] // murky lower moss
  const light = op.rgb_light ?? [104, 118, 84] // lit canopy-line moss
  const count = op.count ?? 14
  // faint attach mat along the very top so strands read as hanging from a canopy
  for (let x = 0; x < size; x += 1)
    for (let y = 0; y < 2; y += 1)
      if (hash01(x, y, seed, layer, 219) < 0.7) paint(buf, size, x, y, light[0], light[1], light[2])
  for (let s = 0; s < count; s += 1) {
    const len = Math.floor(size * (0.5 + hash01(s, seed, layer, 221) * 0.45))
    const half0 = 0.8 + hash01(s, seed, layer, 222) * 1.2
    let cx = hash01(s, seed, layer, 220) * (size - 1)
    for (let yy = 0; yy < len; yy += 1) {
      const t = yy / len
      cx += (value_noise_1d(yy, size, 10, seed, layer, 223 + s * 31) * 2 - 1) * 0.8 // snaking drift
      const half = half0 * (1 - 0.7 * t)
      const tint = 0.85 + hash01(s, yy, seed, layer, 224) * 0.28
      const cr = lerp(light[0], rgb[0], t) * tint,
        cg = lerp(light[1], rgb[1], t) * tint,
        cb = lerp(light[2], rgb[2], t) * tint
      for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx += 1) {
        if (Math.abs(dx) > half + 0.001) continue
        paint(buf, size, Math.round(cx + dx), yy, cr, cg, cb)
      }
    }
  }
}

/** The flora sprite op set — spread into the baker's OP_TABLE (one wire-in line). Names are disjoint from
 *  every base op. @type {Record<string, (buf: Float32Array, size: number, seed: number, layer: number, op: any, vi?: number, vc?: number) => void>} */
export const FLORA_OPS = {
  needle_spray: op_needle_spray,
  frond: op_frond,
  moss_drape: op_moss_drape,
  stalks: op_stalks,
  bloom: op_bloom,
  bush: op_bush,
  branch: op_branch,
  pebbles: op_pebbles,
  mushroom: op_mushroom,
  shell: op_shell,
  starfish: op_starfish,
  cattail: op_cattail,
  lilypad: op_lilypad,
}
