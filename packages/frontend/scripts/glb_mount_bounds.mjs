// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// glb_mount_bounds.mjs — pure GLB JSON-chunk geometry math shared by the cosmetic GLB corrective editor
// (fix_cosmetic_glbs.mjs) and its RED/GREEN oracle (verify_cosmetic_glbs.mjs). Mount space = the GLB scene
// root frame, i.e. the frame the engine parents to the rig bone (Head / cape) when the cosmetic is worn.

import { readFileSync } from 'node:fs'

/** Parse the JSON chunk of a .glb file. */
export function read_glb_json(path) {
  const buffer = readFileSync(path)
  const json_length = buffer.readUInt32LE(12)
  return JSON.parse(buffer.subarray(20, 20 + json_length).toString('utf8'))
}

function quat_to_matrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ]
}

/** Apply a node's TRS (glTF order: translate ∘ rotate ∘ scale) to a point. */
export function apply_trs(node, [px, py, pz]) {
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const scaled = [px * sx, py * sy, pz * sz]
  const m = quat_to_matrix(node.rotation ?? [0, 0, 0, 1])
  const rotated = m.map((row) => row[0] * scaled[0] + row[1] * scaled[1] + row[2] * scaled[2])
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  return [rotated[0] + tx, rotated[1] + ty, rotated[2] + tz]
}

/**
 * Union of every mesh node's transformed POSITION AABB, in mount space. `override_node` lets a caller
 * substitute one node's TRS (e.g. translation zeroed) without mutating the parsed JSON.
 * @param {object} json parsed GLB JSON chunk
 * @param {{ index: number, node: object } | null} [override_node]
 */
export function mount_space_bounds(json, override_node = null) {
  const nodes = json.nodes ?? []
  const parents = new Map()
  for (const [index, node] of nodes.entries()) for (const child of node.children ?? []) parents.set(child, index)
  const node_at = (index) => (override_node && override_node.index === index ? override_node.node : nodes[index])
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const [index, node] of nodes.entries()) {
    if (node.mesh === undefined) continue
    for (const primitive of json.meshes[node.mesh].primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION]
      if (!accessor?.min || !accessor?.max) continue
      for (let corner = 0; corner < 8; corner += 1) {
        let point = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? accessor.max[axis] : accessor.min[axis]))
        for (let at = index; at !== undefined; at = parents.get(at)) point = apply_trs(node_at(at), point)
        for (const axis of [0, 1, 2]) {
          box.min[axis] = Math.min(box.min[axis], point[axis])
          box.max[axis] = Math.max(box.max[axis], point[axis])
        }
      }
    }
  }
  return box
}
