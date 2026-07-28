#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Corrective editor for owner-flagged cosmetic GLB defects (models/equipment is gitignored — THIS script is
// the durable, replayable custody of every byte-level correction; verify_cosmetic_glbs.mjs is its RED/GREEN
// oracle). Fix 1 (lane GLBFIX): the two variant-mapping defects. Both turned out
// to be the SAME class of bug — a malformed KHR_materials_variants mapping where one material's `variants`
// list wrongly includes a variant index that already has its own correct dedicated mapping. Because
// bake_variant()'s `.find()` (AND three.js in-game) is FIRST-WINS, the stray index resolves to the wrong
// material, so the variant renders as a different one:
//
//   * cape_lorito.glb  mesh0/prim0: {material:3 (intelligence), variants:[3,4]} steals strength(idx4) from the
//     correct {material:4 (strength), variants:[4]} -> `strength` bakes intelligence (Ruby == Amber).
//   * capuche_bara.glb mesh1/prim0: {material:1 (base), variants:[0,1]} steals wisdom(idx0) from the correct
//     {material:7 (WISDOM), variants:[0]} -> `wisdom` bakes base (Base == Wisdom). (VISPROOF misread this as a
//     texture near-dupe; a last-wins analysis hides the collision. The authored cappy_wisdom is already violet.)
//
// Fix = for every primitive, drop each variant index from any mapping whose material name does NOT match the
// variant's own name, leaving it only in its name-matched mapping. Pure JSON-chunk edit; the BIN buffer (geometry
// + textures) is byte-for-byte untouched. These GLBs under models/equipment/ are the single source both the
// render pipeline and the published `cosmetic` asset class read.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mount_space_bounds, read_glb_json } from './glb_mount_bounds.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const equipment_dir = resolve(script_dir, '../../../models/equipment')

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

function read_glb(path) {
  const buffer = readFileSync(path)
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${path}: not a GLB`)
  const json_length = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${path}: first chunk is not JSON`)
  const json = JSON.parse(buffer.subarray(20, 20 + json_length).toString('utf8'))
  const bin_header = 20 + json_length
  let bin = Buffer.alloc(0)
  if (bin_header < buffer.length) {
    const bin_length = buffer.readUInt32LE(bin_header)
    if (buffer.readUInt32LE(bin_header + 4) !== CHUNK_BIN) throw new Error(`${path}: second chunk is not BIN`)
    bin = buffer.subarray(bin_header + 8, bin_header + 8 + bin_length)
  }
  return { bin, json }
}

// Rebuild a 2-chunk GLB from a JSON object + an UNCHANGED BIN payload, re-padding the JSON chunk (0x20) and
// rewriting the length fields. The BIN chunk is copied verbatim (with its existing padding), so geometry and
// every embedded texture stay byte-identical.
function write_glb(path, json, bin) {
  let json_bytes = Buffer.from(JSON.stringify(json), 'utf8')
  const json_pad = (4 - (json_bytes.length % 4)) % 4
  if (json_pad) json_bytes = Buffer.concat([json_bytes, Buffer.alloc(json_pad, 0x20)])
  const total = 12 + 8 + json_bytes.length + (bin.length ? 8 + bin.length : 0)
  const out = Buffer.alloc(total)
  out.writeUInt32LE(GLB_MAGIC, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(json_bytes.length, 12)
  out.writeUInt32LE(CHUNK_JSON, 16)
  json_bytes.copy(out, 20)
  if (bin.length) {
    const cursor = 20 + json_bytes.length
    out.writeUInt32LE(bin.length, cursor)
    out.writeUInt32LE(CHUNK_BIN, cursor + 4)
    bin.copy(out, cursor + 8)
  }
  writeFileSync(path, out)
  return out.length
}

// Enforce a first-wins bijection: a variant index may only live in the mapping whose material NAME matches the
// variant's name (case-insensitive). Any other mapping that also lists that index is holding it by mistake and
// gets it removed. Returns the list of applied removals for the report.
function dedupe_variant_mappings(json) {
  const variants = (json.extensions?.KHR_materials_variants?.variants ?? []).map((v) => String(v?.name ?? ''))
  const material_name = (index) => String(json.materials?.[index]?.name ?? '')
  const removals = []
  for (const [mesh_index, mesh] of (json.meshes ?? []).entries()) {
    for (const [prim_index, primitive] of (mesh.primitives ?? []).entries()) {
      const mappings = primitive.extensions?.KHR_materials_variants?.mappings
      if (!Array.isArray(mappings)) continue
      for (const variant_index of variants.keys()) {
        const owners = mappings.filter((m) => Array.isArray(m.variants) && m.variants.includes(variant_index))
        if (owners.length < 2) continue // no collision
        const variant_name = variants[variant_index].toLowerCase()
        const rightful = owners.find((m) => material_name(m.material).toLowerCase() === variant_name)
        if (!rightful) continue // ambiguous — never guess; leave as-authored
        for (const owner of owners) {
          if (owner === rightful) continue
          owner.variants = owner.variants.filter((v) => v !== variant_index)
          removals.push({
            from_material: `${owner.material}(${material_name(owner.material)})`,
            mesh: mesh_index,
            prim: prim_index,
            rightful_material: `${rightful.material}(${material_name(rightful.material)})`,
            variant: `${variant_index}(${variants[variant_index]})`,
          })
        }
      }
    }
  }
  return removals
}

function fix_file(name) {
  const path = resolve(equipment_dir, name)
  const { bin, json } = read_glb(path)
  const removals = dedupe_variant_mappings(json)
  const bytes = write_glb(path, json, bin)
  const summary = removals.length
    ? removals
        .map(
          (r) =>
            `mesh${r.mesh}/prim${r.prim}: removed variant ${r.variant} from ${r.from_material} (rightful ${r.rightful_material})`
        )
        .join('; ')
    : 'no collision found'
  console.log(`${name}: ${summary}; wrote ${bytes} bytes (BIN unchanged)`)
}

// ── Fix 2 (lane COSMETIC-TRUTH — regression: Mo's hood rendered as a black mass towering on the head):
// capuche_mo.glb is authored with the cape-family rotation/scale (root node 'CAPE', X -90°, 0.043) but NO
// translation — parented to the back mount its 44-unit drape extends UP (44·0.043 ≈ 1.9) and towers over the
// head instead of hanging down. Derive the missing translation from the reference cape rather than a hand
// constant: drop the drape so its mount-space TOP lands on the reference's proven collar line. x/z stay 0 —
// mo's back plane already aligns with lorito's without a z offset (measured -0.387 vs -0.3866).
function fix_cape_anchor(name, reference_name) {
  const path = resolve(equipment_dir, name)
  const { bin, json } = read_glb(path)
  const mesh_nodes = (json.nodes ?? [])
    .map((node, index) => ({ index, node }))
    .filter(({ node }) => node.mesh !== undefined)
  if (mesh_nodes.length !== 1 || mesh_nodes[0].node.name !== 'CAPE')
    throw new Error(`${name}: expected a single 'CAPE' mesh node — refusing to guess the anchor`)
  const [{ index, node }] = mesh_nodes
  const [, collar_top] = mount_space_bounds(read_glb_json(resolve(equipment_dir, reference_name))).max
  const bare = mount_space_bounds(json, { index, node: { ...node, translation: [0, 0, 0] } })
  const target_ty = collar_top - bare.max[1]
  const [current_tx, current_ty, current_tz] = node.translation ?? [0, 0, 0]
  if (current_tx === 0 && current_tz === 0 && Math.abs(current_ty - target_ty) < 1e-6) {
    console.log(`${name}: cape anchor already correct (ty=${target_ty.toFixed(6)}) — no-op`)
    return
  }
  node.translation = [0, target_ty, 0]
  const bytes = write_glb(path, json, bin)
  const after = mount_space_bounds(json)
  console.log(
    `${name}: anchored to ${reference_name} collar line — translation [0, ${target_ty.toFixed(6)}, 0]; ` +
      `mount-space y ∈ [${after.min[1].toFixed(3)}, ${after.max[1].toFixed(3)}]; wrote ${bytes} bytes (BIN unchanged)`
  )
}

fix_file('cape_lorito.glb')
fix_file('capuche_bara.glb')
fix_cape_anchor('capuche_mo.glb', 'cape_lorito.glb')
