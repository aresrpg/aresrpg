// [team-outline] POSITION-WELDED, ANGLE-WEIGHTED smoothed normals — the fix that turns the inverted-hull
// entity outline from voxel corner-noise into one clean silhouette rim.
//
// Voxel character rigs ship HARD per-face normals: a single position (a cube corner) appears once PER
// incident face, each copy carrying that face's normal. Pushing an inverted-hull shell along those hard
// normals separates the shell at EVERY interior cube edge, not just the outer silhouette — visible seams
// on every corner, which reads as broken on voxel geometry. The cure is to give the SHELL geometry
// normals that are averaged across every vertex sharing a position: at a shared corner all copies then
// push the SAME direction, so the shell stays welded there and only the true outer silhouette protrudes
// — the default three.js OutlinePass look.
//
// Weighting is ANGLE-based (Thürmer & Wüthrich 1998): each incident triangle contributes its face normal
// scaled by the triangle's interior ANGLE at the shared vertex. Angle weighting is triangulation-
// independent — the sum of a polygon-corner's triangle angles equals the true surface corner angle — so
// a quad split either way yields the same welded normal (a cube's 24 hard face normals collapse to the 8
// exact corner-diagonal normals regardless of how each face was triangulated). PURE (plain typed arrays,
// no three dependency) so it unit-tests headless without a GPU. 2026-07-10.

/** Position-quantization grid for the weld key (LOCAL rig units ≈ metres). 1e-4 = 0.1 mm — far below any
 *  real vertex spacing, far above float/DRACO-dequantization noise, so genuinely-shared corners collapse
 *  to one group while distinct verts never falsely merge. */
const WELD_EPS = 1e-4

/** Interior angle at `p` between the rays p→a and p→b (radians); 0 on a degenerate (zero-length) edge.
 *  @param {number} px @param {number} py @param {number} pz @param {number} ax @param {number} ay
 *  @param {number} az @param {number} bx @param {number} by @param {number} bz @returns {number} */
function corner_angle(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = ax - px,
    uy = ay - py,
    uz = az - pz
  const vx = bx - px,
    vy = by - py,
    vz = bz - pz
  const ul = Math.hypot(ux, uy, uz)
  const vl = Math.hypot(vx, vy, vz)
  if (ul < 1e-12 || vl < 1e-12) return 0
  let d = (ux * vx + uy * vy + uz * vz) / (ul * vl)
  if (d < -1) d = -1
  else if (d > 1) d = 1
  return Math.acos(d)
}

/**
 * Angle-weighted, position-welded vertex normals. Same vertex COUNT/order as the input — only the normal
 * DIRECTIONS change (position / skinIndex / skinWeight are the caller's to carry over unchanged). A
 * degenerate weld group (every incident triangle zero-area) falls back to that vertex's ORIGINAL normal
 * (or +Y if that too is zero), so the result is always finite and unit-length.
 *
 * @param {ArrayLike<number>} positions flat xyz per vertex, length = 3·vertexCount
 * @param {ArrayLike<number>} normals   flat xyz per vertex — originals, used only as a degenerate fallback
 * @param {ArrayLike<number> | null} index triangle indices (3 per tri), or null for a non-indexed soup
 * @returns {Float32Array} smoothed normals, length = 3·vertexCount
 */
export function weld_smoothed_normals(positions, normals, index) {
  const vcount = (positions.length / 3) | 0

  // 1. group vertices by quantized position → a group id per vertex.
  const group_of = new Int32Array(vcount)
  /** @type {Map<string, number>} */
  const key_to_group = new Map()
  let gcount = 0
  const q = (/** @type {number} */ v) => Math.round(v / WELD_EPS)
  for (let i = 0; i < vcount; i += 1) {
    const key = `${q(positions[i * 3])},${q(positions[i * 3 + 1])},${q(positions[i * 3 + 2])}`
    let g = key_to_group.get(key)
    if (g === undefined) {
      g = gcount
      gcount += 1
      key_to_group.set(key, g)
    }
    group_of[i] = g
  }

  // 2. accumulate angle-weighted face normals into each vertex's group.
  const accum = new Float64Array(gcount * 3)
  const tri_count = index ? (index.length / 3) | 0 : (vcount / 3) | 0
  for (let t = 0; t < tri_count; t += 1) {
    const i0 = index ? index[t * 3] : t * 3
    const i1 = index ? index[t * 3 + 1] : t * 3 + 1
    const i2 = index ? index[t * 3 + 2] : t * 3 + 2
    const ax = positions[i0 * 3],
      ay = positions[i0 * 3 + 1],
      az = positions[i0 * 3 + 2]
    const bx = positions[i1 * 3],
      by = positions[i1 * 3 + 1],
      bz = positions[i1 * 3 + 2]
    const cx = positions[i2 * 3],
      cy = positions[i2 * 3 + 1],
      cz = positions[i2 * 3 + 2]
    // face normal = (b-a) × (c-a), normalized (skip a degenerate/zero-area triangle).
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const nl = Math.hypot(nx, ny, nz)
    if (nl < 1e-12) continue
    nx /= nl
    ny /= nl
    nz /= nl
    const w0 = corner_angle(ax, ay, az, bx, by, bz, cx, cy, cz)
    const w1 = corner_angle(bx, by, bz, ax, ay, az, cx, cy, cz)
    const w2 = corner_angle(cx, cy, cz, ax, ay, az, bx, by, bz)
    const g0 = group_of[i0] * 3,
      g1 = group_of[i1] * 3,
      g2 = group_of[i2] * 3
    accum[g0] += nx * w0
    accum[g0 + 1] += ny * w0
    accum[g0 + 2] += nz * w0
    accum[g1] += nx * w1
    accum[g1 + 1] += ny * w1
    accum[g1 + 2] += nz * w1
    accum[g2] += nx * w2
    accum[g2 + 1] += ny * w2
    accum[g2 + 2] += nz * w2
  }

  // 3. normalize each group's accumulated normal (mark which groups produced a valid one).
  const gnx = new Float64Array(gcount)
  const gny = new Float64Array(gcount)
  const gnz = new Float64Array(gcount)
  const g_ok = new Uint8Array(gcount)
  for (let g = 0; g < gcount; g += 1) {
    const x = accum[g * 3],
      y = accum[g * 3 + 1],
      z = accum[g * 3 + 2]
    const l = Math.hypot(x, y, z)
    if (l > 1e-12) {
      gnx[g] = x / l
      gny[g] = y / l
      gnz[g] = z / l
      g_ok[g] = 1
    }
  }

  // 4. scatter the group normal back to every vertex; degenerate groups keep the vertex's own normal.
  const out = new Float32Array(vcount * 3)
  for (let i = 0; i < vcount; i += 1) {
    const g = group_of[i]
    if (g_ok[g]) {
      out[i * 3] = gnx[g]
      out[i * 3 + 1] = gny[g]
      out[i * 3 + 2] = gnz[g]
      continue
    }
    let x = normals[i * 3] ?? 0,
      y = normals[i * 3 + 1] ?? 0,
      z = normals[i * 3 + 2] ?? 0
    const l = Math.hypot(x, y, z)
    if (l > 1e-12) {
      x /= l
      y /= l
      z /= l
    } else {
      x = 0
      y = 1
      z = 0
    }
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  return out
}
