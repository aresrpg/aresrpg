// [D264b reference: no visible gaps between tiles, fully procedural texturing] THE BOARD SURFACE — one
// CONTIGUOUS paved-stone slab + one procedurally BAKED
// texture for the whole board. This replaces the per-cell instanced floor tiles (which could only ever
// read as separate blocks with gaps — the exact thing the reference forbids).
//
// What the reference frame decodes to (the tactical-reference capture):
//   • ONE slab — cells share edges, ZERO spacing; the grid reads through THIN slightly-darker SEAM
//     lines baked into the texture, never painted borders or floating tiles.
//   • Per-tile tonal variety — cream/beige/gray patches (per-tile hash + a low-frequency patch noise)
//     with fine grain, so no two tiles are identical; the base bake stays checker-free by default
//     (checker_strength 0, byte-identical to the original reference decode).
//   • [tactical-reference revision, 2026-07-20 — ships enabled by default] an OPT-IN parity checker
//     (checker_strength) multiplies alternating (cx+cy) cells lighter/darker on top of the tonal
//     variety — two close-but-distinct paving tones, subtle like the classic isometric look (never chess-loud).
//   • WEAR — hairline cracks on a few tiles, a footprint trail crossing the arena, small grass tufts
//     sprouting at seam crossings.
//   • A RAISED slab with darker stone TRIM: side skirts where the slab meets the land (material 1) and
//     a baked darker rim line along the outline's top edge.
// Highlights stay separate translucent overlays ON the slab (board_highlights.js — untouched).
//
// Two pure builders, consumed by board.js:
//   bake_board_surface({mask,width,height,seed})  → DataTexture (deterministic — same board, same bytes)
//   build_slab_geometry({mask,width,height,cell_size,origin,relief_at,thickness}) → BufferGeometry with
//     2 material groups: 0 = top faces (the baked map), 1 = side skirts (plain darker trim stone).
// Determinism law: every random detail derives from fnv1a(mask,dims) + integer cell hashes, so a
// same-args rebuild reproduces the identical slab (the reconcile-storm guarantee). 2026-07-06.

import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three'

import { CELL_FLOOR, CELL_OBSTACLE, CELL_HOLE, read_cell } from './board.js'

// ---- Surface palette (sampled off the reference frame — pale worn paving) ------------------
const TONE_LIGHT = [0xdd, 0xd4, 0xb6] // pale warm cream (the dominant tile tone)
const TONE_MID = [0xcf, 0xc5, 0xa2] // beige
const TONE_GRAY = [0xc6, 0xc0, 0xae] // pale gray paver
const SEAM_MUL = 0.72 // seam line darkening — deep enough to survive mip averaging at fight distance
const BEVEL_MUL = 1.05 // 1px light bevel beside the seam (chiselled paver edge)
const TRIM_MUL = 0.6 // outline rim darkening (the slab edge line where it meets the land)
const CRACK_MUL = 0.78 // hairline crack darkening
const PRINT_MUL = 0.84 // footprint stamp darkening
const TUFT_GREENS = [
  [0x7a, 0xa0, 0x54],
  [0x5d, 0x87, 0x43],
] // grass tufts at seam crossings
/** Texels per cell edge (clamped so huge boards stay under a 2048px sheet). */
const PX_PER_CELL = 64

/** fnv1a over the mask bytes + dims — THE board seed (deterministic per board). @param {Uint8Array|number[]} mask @param {number} w @param {number} h */
export function board_seed(mask, w, h) {
  let x = 0x811c9dc5
  const eat = (/** @type {number} */ b) => {
    x ^= b & 0xff
    x = Math.imul(x, 0x01000193)
  }
  eat(w)
  eat(h)
  for (let i = 0; i < mask.length; i += 1) eat(/** @type {number} */ (mask[i]))
  return x >>> 0
}

/** Integer 2D hash ∈ [0,1) folded with the board seed (stable per cell/lattice point). */
function hash2(/** @type {number} */ seed, /** @type {number} */ x, /** @type {number} */ y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  n ^= n >>> 16
  return (n >>> 0) / 4294967296
}

/** Smooth value noise ∈ [0,1) over a unit lattice (bilinear + smoothstep) — the tonal patch field. */
function patch_noise(/** @type {number} */ seed, /** @type {number} */ fx, /** @type {number} */ fy) {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash2(seed, x0, y0)
  const b = hash2(seed, x0 + 1, y0)
  const c = hash2(seed, x0, y0 + 1)
  const d = hash2(seed, x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Texel-row band processed per amortization slice. The deferred fight-board bake pumps a few of these
 *  per frame within an ~8ms budget so no single frame eats the whole ~10-27ms paving bake (the fight-start
 *  freeze). At PX_PER_CELL=64 one band is ≤~2ms of texel work. */
export const SURFACE_BAND_ROWS = 96

/**
 * Bakes the whole-board paving texture (RGBA, PX_PER_CELL texels per cell) as a GENERATOR so the work can
 * be spread across frames. The FIRST `next()` yields the (still-blank) DataTexture handle so the caller can
 * BIND it immediately; each later `next()` fills `band_rows` more texel rows of pass 1 (the wear passes run
 * on the final step), calling `needsUpdate` so a bound material shows the paving fill in. Pure +
 * deterministic — the SAME board bytes as before, just produced in slices. Drain with band_rows = Infinity
 * (no mid-pass yields) for the synchronous `bake_board_surface` wrapper below.
 * @param {{ mask: Uint8Array | number[], width: number, height: number, seed?: number, checker_strength?:
 *   number }} args checker_strength (0 default, byte-identical to pre-revision): ± this fraction
 *   lightens/darkens alternating (cx+cy) parity cells — the classic isometric checkerboard, opt-in (shipped
 *   default 0.07, set by board.js).
 * @param {number} [band_rows] texel rows per yielded slice (Infinity ⇒ bake in one synchronous step)
 * @returns {Generator<DataTexture, void, void>}
 */
export function* bake_board_surface_gen(
  { mask, width, height, seed = board_seed(mask, width, height), checker_strength = 0 },
  band_rows = SURFACE_BAND_ROWS
) {
  const px = Math.max(16, Math.min(PX_PER_CELL, Math.floor(2048 / Math.max(width, height))))
  const W = width * px
  const H = height * px
  const data = new Uint8Array(W * H * 4)
  // Texture built UP FRONT over `data` (filled in place below) so a deferred caller binds it at mount and
  // the paving detail fills across frames. Byte-identical to the old tail-created texture once drained.
  const texture = new DataTexture(data, W, H)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8 // the fight cam grazes at ~50° — keep the seams crisp into the distance
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.needsUpdate = true
  yield texture // hand the blank handle to the caller; the bands below fill it in place
  const rgb = /** @type {[number, number, number]} */ ([0, 0, 0])
  const is_slab = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const b = read_cell(mask, cx, cy, width, height)
    return b === CELL_FLOOR || b === CELL_OBSTACLE
  }

  // --- pass 1: per-texel base — per-tile tone (ramp pick + patch field) + fine grain + seams + trim.
  for (let y = 0; y < H; y += 1) {
    const cy = Math.floor(y / px)
    const ly = y - cy * px // texel within the cell (0..px-1)
    for (let x = 0; x < W; x += 1) {
      const cx = Math.floor(x / px)
      const lx = x - cx * px
      // tile tone: hash picks a ramp stop, the low-frequency patch field drifts it (region blotches).
      const t_pick = hash2(seed, cx, cy)
      const base = t_pick < 0.5 ? TONE_LIGHT : t_pick < 0.82 ? TONE_MID : TONE_GRAY
      const patch = 0.92 + patch_noise(seed ^ 0x9e37, cx * 0.35 + x / (px * 6), cy * 0.35 + y / (px * 6)) * 0.14
      const grain = 0.985 + hash2(seed ^ 0x51ed, x, y) * 0.03
      let mul = patch * grain
      // [tactical-reference revision] the parity checker — alternating cells lighten/darken symmetrically
      // around 1.0 so overall board brightness stays balanced; 0 strength is a pure no-op (the original
      // tonal-variety bake, byte-identical).
      if (checker_strength > 0) mul *= (cx + cy) % 2 === 0 ? 1 + checker_strength : 1 - checker_strength
      // seams: a 2-texel darker joint along every interior cell boundary + a 1-texel bevel light beside
      // it. Drawn per-texel (no gaps in the GEOMETRY — the grid is purely this shading).
      const seam_px = 2
      const near_seam = lx < seam_px || ly < seam_px || lx >= px - seam_px || ly >= px - seam_px
      const on_bevel =
        !near_seam && (lx === seam_px || ly === seam_px || lx === px - seam_px - 1 || ly === px - seam_px - 1)
      if (near_seam)
        mul *= SEAM_MUL * (0.94 + hash2(seed ^ 0x7f4a, cx + (lx < 1 ? -1 : 0), cy + (ly < 1 ? -1 : 0)) * 0.12)
      else if (on_bevel) mul *= BEVEL_MUL
      // outline trim: where this cell's edge borders OFF-slab (void / hole / world edge), darken the
      // outer 3 texels — the slab's darker rim line where it meets the land (reference edge read).
      const rim =
        (lx < 4 && !is_slab(cx - 1, cy)) ||
        (ly < 4 && !is_slab(cx, cy - 1)) ||
        (lx >= px - 4 && !is_slab(cx + 1, cy)) ||
        (ly >= px - 4 && !is_slab(cx, cy + 1))
      if (rim) mul *= TRIM_MUL
      rgb[0] = Math.min(255, base[0] * mul)
      rgb[1] = Math.min(255, base[1] * mul)
      rgb[2] = Math.min(255, base[2] * mul)
      const o = (x + y * W) * 4
      const [rr, rg, rb] = rgb
      data[o] = rr
      data[o + 1] = rg
      data[o + 2] = rb
      data[o + 3] = 255
    }
    // amortization slice boundary — after a full band of texel rows, upload what's baked and hand control
    // back so the caller can yield to the next frame. The synchronous drain passes band_rows = Infinity,
    // so this never fires there (pass 1 runs in one step ⇒ byte-identical to the pre-amortization bake).
    if ((y + 1) % band_rows === 0 && y + 1 < H) {
      texture.needsUpdate = true
      yield
    }
  }

  /** multiply one texel toward dark (wear stamps). */
  const stain = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ mul) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const o = (x + y * W) * 4
    data[o] *= mul
    data[o + 1] *= mul
    data[o + 2] *= mul
  }

  // --- pass 2: WEAR. Cracks on ~10% of slab tiles — a short dark polyline wandering from one edge.
  for (let cy = 0; cy < height; cy += 1)
    for (let cx = 0; cx < width; cx += 1) {
      if (!is_slab(cx, cy) || hash2(seed ^ 0xc4ac, cx, cy) >= 0.1) continue
      let vx = cx * px + 4 + Math.floor(hash2(seed ^ 0x11, cx, cy) * (px - 8))
      let vy = cy * px + 2
      let dir = hash2(seed ^ 0x22, cx, cy) * 0.8 - 0.4 // mostly downward wander
      const len = px * (0.4 + hash2(seed ^ 0x33, cx, cy) * 0.5)
      for (let s = 0; s < len; s += 1) {
        stain(vx, vy, CRACK_MUL)
        stain(vx + 1, vy, 0.96) // faint chip highlight beside the crack
        dir += (hash2(seed ^ 0x44, vx, vy) - 0.5) * 0.5
        vx += Math.round(dir)
        vy += 1
      }
    }

  // --- pass 3: a FOOTPRINT TRAIL crossing the arena (the reference's traffic read). Two seeded slab
  // cells far apart; small paired stamps alternate left/right along the line between their centres.
  const slab_cells = /** @type {[number, number][]} */ ([])
  for (let cy = 0; cy < height; cy += 1)
    for (let cx = 0; cx < width; cx += 1) if (is_slab(cx, cy)) slab_cells.push([cx, cy])
  if (slab_cells.length > 4) {
    const a = slab_cells[Math.floor(hash2(seed ^ 0x55, 1, 1) * slab_cells.length)]
    let b = a
    for (const c of slab_cells) {
      if (Math.hypot(c[0] - a[0], c[1] - a[1]) > Math.hypot(b[0] - a[0], b[1] - a[1])) b = c
    }
    const ax = (a[0] + 0.5) * px
    const ay = (a[1] + 0.5) * px
    const steps = Math.floor(Math.hypot((b[0] - a[0]) * px, (b[1] - a[1]) * px) / (px * 0.3))
    const dx = ((b[0] - a[0]) * px) / Math.max(1, steps)
    const dy = ((b[1] - a[1]) * px) / Math.max(1, steps)
    const nx = -dy / Math.hypot(dx, dy) // unit normal — the left/right foot offset
    const ny = dx / Math.hypot(dx, dy)
    for (let s = 0; s < steps; s += 1) {
      const side = s % 2 === 0 ? 3 : -3
      const fx = Math.round(ax + dx * s + nx * side + (hash2(seed ^ 0x66, s, 0) - 0.5) * 3)
      const fy = Math.round(ay + dy * s + ny * side + (hash2(seed ^ 0x77, s, 1) - 0.5) * 3)
      if (!is_slab(Math.floor(fx / px), Math.floor(fy / px))) continue
      for (let oy = -2; oy <= 3; oy += 1) for (let ox = -2; ox <= 2; ox += 1) stain(fx + ox, fy + oy, PRINT_MUL)
    }
  }

  // --- pass 4: GRASS TUFTS at ~5% of interior seam crossings (nature reclaiming the joints).
  for (let cy = 1; cy < height; cy += 1)
    for (let cx = 1; cx < width; cx += 1) {
      if (!(is_slab(cx, cy) && is_slab(cx - 1, cy) && is_slab(cx, cy - 1) && is_slab(cx - 1, cy - 1))) continue
      if (hash2(seed ^ 0x88, cx, cy) >= 0.05) continue
      const gx = cx * px
      const gy = cy * px
      for (let blade = 0; blade < 5; blade += 1) {
        const g = TUFT_GREENS[blade % 2]
        const bx = gx + Math.floor((hash2(seed ^ 0x99, cx * 8 + blade, cy) - 0.5) * 8)
        const h = 2 + Math.floor(hash2(seed ^ 0xaa, blade, cy) * 3)
        for (let k = 0; k < h; k += 1) {
          const o = (Math.max(0, Math.min(W - 1, bx)) + Math.max(0, Math.min(H - 1, gy - k)) * W) * 4
          const [gr, gg, gb] = g
          data[o] = gr
          data[o + 1] = gg
          data[o + 2] = gb
        }
      }
    }

  texture.needsUpdate = true // final upload — the wear passes just stamped over the baked base
}

/**
 * Synchronous whole-board bake — byte-identical to the pre-amortization function. Drains the generator in
 * one step (Infinity band ⇒ pass 1 never yields mid-way). Every caller wanting the finished texture
 * immediately (unit tests, non-fight boards, dev demos) uses this; the fight board uses the generator.
 * @param {{ mask: Uint8Array | number[], width: number, height: number, seed?: number, checker_strength?:
 *   number }} args
 * @returns {DataTexture}
 */
export function bake_board_surface(args) {
  const gen = bake_board_surface_gen(args, Number.POSITIVE_INFINITY)
  const texture = /** @type {DataTexture} */ (gen.next().value) // the handle (first yield)
  let r
  do {
    r = gen.next() // one step bakes pass 1 (whole) + the wear passes, then done
  } while (!r.done)
  return texture
}

/**
 * Builds the merged CONTIGUOUS slab geometry: one top quad per slab cell (floor + obstacle — props sit
 * ON the paving) at that cell's floor plane + thickness, plus side skirts wherever the slab meets
 * off-slab space (outline, hole openings) or steps between relief tiers. Two groups: 0 = tops (baked
 * map, UV = cell coords / dims), 1 = sides (trim material). World-space vertices (matches the
 * instanced props' coordinate convention).
 * @param {{ mask: Uint8Array | number[], width: number, height: number, cell_size: number,
 *   origin: { x: number, y: number, z: number }, relief_at: (x: number, y: number) => number,
 *   thickness: number }} args
 * @returns {BufferGeometry}
 */
export function build_slab_geometry({ mask, width, height, cell_size, origin, relief_at, thickness }) {
  const positions = /** @type {number[]} */ ([])
  const normals = /** @type {number[]} */ ([])
  const uvs = /** @type {number[]} */ ([])
  const top_indices = /** @type {number[]} */ ([])
  const side_indices = /** @type {number[]} */ ([])
  const SKIRT_DROP = 0.35 // sides run this far below the floor plane (buried into the land — no gap)

  const is_slab = (/** @type {number} */ x, /** @type {number} */ y) => {
    const b = read_cell(mask, x, y, width, height)
    return b === CELL_FLOOR || b === CELL_OBSTACLE
  }
  const top_y = (/** @type {number} */ x, /** @type {number} */ y) => origin.y + relief_at(x, y) + thickness

  /** push one vertex, returns its index. */
  const vert = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ z,
    /** @type {number} */ nx,
    /** @type {number} */ ny,
    /** @type {number} */ nz,
    /** @type {number} */ u,
    /** @type {number} */ v
  ) => {
    positions.push(x, y, z)
    normals.push(nx, ny, nz)
    uvs.push(u, v)
    return positions.length / 3 - 1
  }
  /** quad from 4 vertex indices (a,b,c,d counter-clockwise) into a group's index list. */
  const quad = (
    /** @type {number[]} */ into,
    /** @type {number} */ a,
    /** @type {number} */ b,
    /** @type {number} */ c,
    /** @type {number} */ d
  ) => {
    into.push(a, b, c, a, c, d)
  }

  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      if (!is_slab(cx, cy)) continue
      const x0 = origin.x + cx * cell_size
      const x1 = x0 + cell_size
      const z0 = origin.z + cy * cell_size
      const z1 = z0 + cell_size
      const ty = top_y(cx, cy)
      // TOP — full-cell quad, corners shared with neighbours by construction (identical coordinates ⇒
      // a contiguous surface, zero spacing). UVs address this cell's window of the baked sheet.
      const u0 = cx / width
      const u1 = (cx + 1) / width
      const v0 = cy / height
      const v1 = (cy + 1) / height
      const a = vert(x0, ty, z0, 0, 1, 0, u0, v0)
      const b = vert(x1, ty, z0, 0, 1, 0, u1, v0)
      const c = vert(x1, ty, z1, 0, 1, 0, u1, v1)
      const d = vert(x0, ty, z1, 0, 1, 0, u0, v1)
      quad(top_indices, a, d, c, b) // +Y winding (CCW seen from above)
      // SIDES — for each of the 4 edges: emit a skirt when the neighbour is off-slab (outline / hole
      // opening) or sits on a LOWER relief tier (the step face; the higher cell owns the face).
      const edges = /** @type {[number, number, [number,number], [number,number], [number,number]][]} */ ([
        // [nx_cell, ny_cell, edge p0(x,z), edge p1(x,z), outward normal(x,z)]
        [cx, cy - 1, [x0, z0], [x1, z0], [0, -1]], // north edge (−Z)
        [cx + 1, cy, [x1, z0], [x1, z1], [1, 0]], // east
        [cx, cy + 1, [x1, z1], [x0, z1], [0, 1]], // south
        [cx - 1, cy, [x0, z1], [x0, z0], [-1, 0]], // west
      ])
      for (const [nx, ny, p0, p1, n] of edges) {
        const neighbour_slab = is_slab(nx, ny)
        const bottom = neighbour_slab ? top_y(nx, ny) : origin.y + relief_at(cx, cy) - SKIRT_DROP
        if (neighbour_slab && bottom >= ty - 1e-4) continue // same tier or higher — no face
        const e0 = vert(p0[0], ty, p0[1], n[0], 0, n[1], 0, 0)
        const e1 = vert(p1[0], ty, p1[1], n[0], 0, n[1], 0, 0)
        const e2 = vert(p1[0], bottom, p1[1], n[0], 0, n[1], 0, 0)
        const e3 = vert(p0[0], bottom, p0[1], n[0], 0, n[1], 0, 0)
        quad(side_indices, e0, e1, e2, e3)
      }
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geo.setIndex([...top_indices, ...side_indices])
  geo.addGroup(0, top_indices.length, 0) // material 0 — the baked paving map
  geo.addGroup(top_indices.length, side_indices.length, 1) // material 1 — trim stone sides
  return geo
}
