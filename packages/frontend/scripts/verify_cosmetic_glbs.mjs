#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Deterministic, GPU-free oracle for owner-flagged cosmetic GLB defects. Run BEFORE the fix
// to reproduce the failures (RED) and AFTER to prove them closed (GREEN). It asserts on the GLB bytes — a
// noise-free signal stronger than a WebGPU render — and is the RED-FIRST regression evidence.
//
// Check 1 (lane GLBFIX): a KHR_materials_variants FIRST-WINS mapping collision (bake_variant()/three.js pick
// the first mapping that lists a variant index). The check resolves every variant with first-wins and requires
// it to land on the material whose NAME matches the variant name. The bugs collapse `strength`->intelligence
// (cape_lorito) and `wisdom`->base (capuche_bara).
//
// Check 2 (lane COSMETIC-TRUTH — regression: Mo's hood rendered as a black mass towering on the head):
// every CLOAK-slot GLB (seed/mainnet/shop.json cosmetics category 'cloak') must HANG from the back mount.
// Measured on the three approved reference capes (node-transformed POSITION bounds, mount space):
//   cape_lorito y ∈ [-1.848, +0.087] · cape_fuwa y ∈ [-1.590, +0.087] · cape_kamui y ∈ [-1.763, +0.817]
// capuche_mo was authored with the cape rotation/scale but NO translation → y ∈ [0, +1.892]: the whole
// 44-unit drape extends UP from the back mount and towers over the head. The invariant that separates
// broken from every working cape: y_min ≤ -1.0 (it drapes down) AND y_max ≤ +1.0 (nothing towers).

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { mount_space_bounds, read_glb_json } from './glb_mount_bounds.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))

const is_directory = (candidate) => {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

const content_paths = (seed_dir, equipment_dir) => ({
  equipment_dir,
  seed_shop_path: join(seed_dir, 'shop.json'),
})

// Content left this repository in the seed split. Resolve at the first verifier call so importing this
// module stays pure, and keep the explicit override ahead of the sibling-checkout and legacy merged layouts.
export const content_path_candidates = (env = process.env) =>
  [
    env.ARES_SEED_DIR
      ? content_paths(
          env.ARES_SEED_DIR,
          env.ARES_EQUIPMENT_DIR ?? resolve(env.ARES_SEED_DIR, '..', 'models', 'equipment')
        )
      : null,
    content_paths(
      resolve(script_dir, '../../../../aresrpg-seed/seed/mainnet'),
      resolve(script_dir, '../../../../aresrpg-seed/seed/models/equipment')
    ),
    content_paths(resolve(script_dir, '../../../seed/mainnet'), resolve(script_dir, '../../../models/equipment')),
  ].filter(Boolean)

export const pick_content_paths = (candidates) => {
  const found = candidates.find(
    ({ equipment_dir, seed_shop_path }) => is_directory(equipment_dir) && existsSync(seed_shop_path)
  )
  if (found) return found
  const tried = candidates.map(({ equipment_dir, seed_shop_path }) => `${seed_shop_path} + ${equipment_dir}`).join(', ')
  throw new Error(
    `verify_cosmetic_glbs: no seed shop + equipment corpus found — set ARES_SEED_DIR (and ARES_EQUIPMENT_DIR when models are elsewhere). Tried: ${tried || '(none)'}`
  )
}

export const resolve_content_paths = () => pick_content_paths(content_path_candidates())

// First-wins variant resolution over one primitive, mirroring bake_variant()'s `.find()`.
function resolve_first_wins(primitive, variant_count) {
  const mappings = primitive.extensions?.KHR_materials_variants?.mappings ?? []
  const out = []
  for (let variant = 0; variant < variant_count; variant += 1) {
    const match = mappings.find((m) => Array.isArray(m.variants) && m.variants.includes(variant))
    out.push(match ? match.material : primitive.material)
  }
  return out
}

// A GLB passes when, for every primitive that carries variant mappings, first-wins resolution sends each
// variant to the material whose name matches (case-insensitive) — i.e. a name-correct bijection.
function check_glb(name, focus, equipment_dir) {
  const json = read_glb_json(resolve(equipment_dir, name))
  const variants = (json.extensions?.KHR_materials_variants?.variants ?? []).map((v) => String(v?.name ?? ''))
  const material_name = (i) => String(json.materials?.[i]?.name ?? '')
  let pass = true
  const lines = []
  for (const [mesh_index, mesh] of (json.meshes ?? []).entries()) {
    for (const [prim_index, primitive] of (mesh.primitives ?? []).entries()) {
      if (!primitive.extensions?.KHR_materials_variants) continue
      const resolved = resolve_first_wins(primitive, variants.length)
      for (const [variant_index, variant_name] of variants.entries()) {
        const material = resolved[variant_index]
        const named_material = json.materials?.findIndex(
          (m) => String(m?.name ?? '').toLowerCase() === variant_name.toLowerCase()
        )
        const ok = named_material < 0 || material === named_material
        if (!ok) pass = false
        const mark = focus.includes(variant_name) ? '  <==' : ''
        if (focus.includes(variant_name) || !ok)
          lines.push(
            `  mesh${mesh_index}/prim${prim_index} ${variant_name} -> mat${material}(${material_name(material)}) ` +
              `[want ${named_material}(${material_name(named_material)})] ${ok ? 'ok' : 'WRONG'}${mark}`
          )
      }
    }
  }
  console.log(`[${name}] first-wins name-bijection => ${pass ? 'PASS' : 'FAIL'}`)
  for (const line of lines) console.log(line)
  return pass
}

// ── Check 2: cloak-slot GLBs hang downward from the back mount (mount-space bounds oracle) ──

const HANG_FLOOR = -1.0 // y_min must reach at least this far DOWN (every real cape drapes to ≤ -1.59)
const TOWER_CEILING = 1.0 // y_max must stay under this (worst honest cape: kamui collar +0.817; broken mo: +1.892)

function cloak_appearances(seed_shop_path) {
  const rows = JSON.parse(readFileSync(seed_shop_path, 'utf8')).cosmetics ?? []
  return [...new Set(rows.filter((row) => row.category === 'cloak').map((row) => row.appearance))].sort()
}

function check_cloak_hang(appearance, equipment_dir) {
  const json = read_glb_json(resolve(equipment_dir, `${appearance}.glb`))
  const { min, max } = mount_space_bounds(json)
  const hangs = min[1] <= HANG_FLOOR
  const towers = max[1] > TOWER_CEILING
  const ok = hangs && !towers
  console.log(
    `[${appearance}.glb] mount-space y ∈ [${min[1].toFixed(3)}, ${max[1].toFixed(3)}] => ` +
      `${ok ? 'PASS' : `FAIL${hangs ? '' : ' (does not drape down)'}${towers ? ' (towers above the mount)' : ''}`}`
  )
  return ok
}

export const main = ({ equipment_dir, seed_shop_path } = resolve_content_paths()) => {
  const lorito = check_glb('cape_lorito.glb', ['intelligence', 'strength'], equipment_dir)
  const bara = check_glb('capuche_bara.glb', ['base', 'wisdom'], equipment_dir)
  console.log('')
  const cloaks_ok = cloak_appearances(seed_shop_path)
    .map((appearance) => check_cloak_hang(appearance, equipment_dir))
    .every(Boolean)
  const all = lorito && bara && cloaks_ok
  console.log(`\nRESULT: ${all ? 'GREEN (all defects closed)' : 'RED (defect(s) present)'}`)
  process.exitCode = all ? 0 : 1
  return all
}

const invoked_path = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (import.meta.url === invoked_path) main()
