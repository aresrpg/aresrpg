#!/usr/bin/env node
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

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mount_space_bounds, read_glb_json } from './glb_mount_bounds.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const equipment_dir = resolve(script_dir, '../../../models/equipment')
const seed_shop_path = resolve(script_dir, '../../../seed/mainnet/shop.json')

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
function check_glb(name, focus) {
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

function cloak_appearances() {
  const rows = JSON.parse(readFileSync(seed_shop_path, 'utf8')).cosmetics ?? []
  return [...new Set(rows.filter((row) => row.category === 'cloak').map((row) => row.appearance))].sort()
}

function check_cloak_hang(appearance) {
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

const lorito = check_glb('cape_lorito.glb', ['intelligence', 'strength'])
const bara = check_glb('capuche_bara.glb', ['base', 'wisdom'])
console.log('')
const cloaks_ok = cloak_appearances()
  .map((appearance) => check_cloak_hang(appearance))
  .every(Boolean)
const all = lorito && bara && cloaks_ok
console.log(`\nRESULT: ${all ? 'GREEN (all defects closed)' : 'RED (defect(s) present)'}`)
process.exitCode = all ? 0 : 1
