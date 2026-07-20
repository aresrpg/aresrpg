#!/usr/bin/env node
// reset_mob_decals.mjs — [S-82] ONE-TIME re-bake that resets each ambient critter's skin_decal atlas to its
// VANILLA legacy-corpus source skin (original alpha, NO feather, NO dark-key), WITHOUT re-running the full converter.
// Re-baking from the source model format (locked in the 3.4 GB Assets.zip) risks regressing the hard-won FK /
// eye-flush / skin work; this touches ONLY the skin_decal texture bytes and leaves every byte of geometry /
// animation / body atlas exactly as shipped.
//
// WHY (option C was picked, docs/MOB_FIDELITY_EYES.md): the shipped decal atlas was RGB-feathered (softening
// the ~6–10 texel pupils) and alpha-keyed (lum<48 → transparent, which PUNCHED SEE-THROUGH HOLES through dark
// pupils/nostrils — the reported "weird eyes" defect). Both were applied by the now-deleted decal_alpha_key.mjs /
// key_existing_decals.mjs migration. With the runtime mob loader now sampling NearestFilter (engine
// apply_pixel_filter), the vanilla original alpha is the highest-fidelity source: the dark eye FRAME reads as a
// crisp 1-texel outline (not a Linear-smeared "black plane"), and pupils/nostrils keep their solid dark pixels.
// This is the exact transform the graded FIX-C proof GLBs used (a throwaway working script), productionised.
//
// MECHANISM (safe append-and-repoint): decode the vanilla source PNG, verify its dims match the shipped decal
// atlas (UVs are preserved only if identical), re-encode, then APPEND it at the (4-aligned) end of the BIN chunk
// and repoint ONLY the skin_decal image's bufferView. No accessor / body-atlas offset changes; the old decal
// bytes become harmless dead space. Result: a valid GLB with the identical rig, crisp original-pixel eyes.
//
// SOURCE: the vanilla skins live ONLY in Assets.zip (a proprietary third-party asset archive — never vendored into the repo), read
// straight from the archive via `unzip -p`, exactly like scripts/extract_assets.mjs. Bump MODEL_VERSION in
// src/game/data/mobs.js after running so browsers/SW re-fetch the changed GLB bytes.
//
// USAGE (from packages/frontend):  node scripts/reset_mob_decals.mjs [--dry]

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = resolve(__dirname, '../public/sprites/mobs/models')
const ASSETS_ZIP = resolve(process.env.HOME, 'dev/reference-corpus/server-template/Assets.zip')
const DRY = process.argv.includes('--dry')

// The four light-bodied ambient critters that carry decal-quad eyes (the dark trailer dragons / spectre are
// intentionally near-black — they have no readable pupil to protect and are excluded). Each maps to its vanilla
// source skin path inside Assets.zip (the SAME --texture the original conversion baked the decal from).
const MOBS = {
  bunny: 'Common/NPC/Livestock/Bunny/Models/Texture.png',
  chick: 'Common/NPC/Livestock/Chick/Models/Texture.png',
  lamb: 'Common/NPC/Livestock/Lamb/Models/Texture.png',
  tortoise: 'Common/NPC/Wildlife/Tortoise/Models/Texture.png',
}

if (!existsSync(ASSETS_ZIP)) {
  console.warn(`Assets.zip not found at ${ASSETS_ZIP}. Cannot reset decals (source skins live only there).`)
  process.exit(1)
}

// ── locate pngjs (declared dep, hoist, or the bun store) so this stays runnable regardless of install state ──
async function load_png() {
  try {
    return (await import('pngjs')).PNG
  } catch {
    let dir = __dirname
    for (let up = 0; up < 8; up += 1) {
      const bun = resolve(dir, 'node_modules/.bun')
      if (existsSync(bun)) {
        const hit = readdirSync(bun).find((e) => e.startsWith('pngjs@'))
        if (hit) return (await import(resolve(bun, hit, 'node_modules/pngjs/lib/png.js'))).PNG
      }
      dir = resolve(dir, '..')
    }
    throw new Error('pngjs not found (declared dep or bun store)')
  }
}
const PNG = await load_png()

// ── GLB (de)serialisation ────────────────────────────────────────────────────────────────────────────────
const GLB_MAGIC = 0x46546c67,
  JSON_TYPE = 0x4e4f534a,
  BIN_TYPE = 0x004e4942
function parse_glb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB')
  let o = 12,
    json = null,
    bin = null
  while (o < buf.length) {
    const len = buf.readUInt32LE(o),
      type = buf.readUInt32LE(o + 4)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === JSON_TYPE) json = JSON.parse(data.toString('utf8'))
    else if (type === BIN_TYPE) bin = Buffer.from(data)
    o += 8 + len
  }
  if (!json || !bin) throw new Error('missing JSON/BIN chunk')
  return { json, bin }
}
const pad4 = (n) => (n + 3) & ~3
function write_glb(json, bin) {
  const json_buf = Buffer.from(JSON.stringify(json), 'utf8')
  const json_pad = Buffer.alloc(pad4(json_buf.length) - json_buf.length, 0x20) // spaces
  const bin_pad = Buffer.alloc(pad4(bin.length) - bin.length, 0x00)
  const json_len = json_buf.length + json_pad.length,
    bin_len = bin.length + bin_pad.length
  const total = 12 + 8 + json_len + 8 + bin_len
  const head = Buffer.alloc(12)
  head.writeUInt32LE(GLB_MAGIC, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(total, 8)
  const jh = Buffer.alloc(8)
  jh.writeUInt32LE(json_len, 0)
  jh.writeUInt32LE(JSON_TYPE, 4)
  const bh = Buffer.alloc(8)
  bh.writeUInt32LE(bin_len, 0)
  bh.writeUInt32LE(BIN_TYPE, 4)
  return Buffer.concat([head, jh, json_buf, json_pad, bh, bin, bin_pad])
}

// ── per-GLB: swap the skin_decal image for the vanilla source, append + repoint its bufferView ───────────────
function process_glb(json, bin, vanilla_png) {
  const mat = (json.materials ?? []).find((m) => m.name === 'skin_decal')
  if (!mat) return null // no decal quads — nothing to do
  const tex_idx = mat.pbrMetallicRoughness?.baseColorTexture?.index
  const img_idx = json.textures?.[tex_idx]?.source
  const img = json.images?.[img_idx]
  if (img?.bufferView == null) throw new Error('skin_decal image is not a bufferView')
  const bv = json.bufferViews[img.bufferView]

  // guard: the image bufferView must be exclusively the image's (no accessor / other image shares it)
  const shared =
    (json.accessors ?? []).some((a) => a.bufferView === img.bufferView) ||
    (json.images ?? []).some((im, i) => i !== img_idx && im.bufferView === img.bufferView)
  if (shared) throw new Error('skin_decal bufferView is shared — unsafe to repoint')

  // guard: dims MUST match the shipped decal atlas — UVs are only preserved if the texture size is identical.
  const shipped = PNG.sync.read(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength))
  const src = PNG.sync.read(vanilla_png)
  if (src.width !== shipped.width || src.height !== shipped.height)
    throw new Error(`dim mismatch: vanilla ${src.width}x${src.height} vs shipped ${shipped.width}x${shipped.height}`)

  const new_png = PNG.sync.write(src) // vanilla, verbatim: original alpha, no feather, no key
  const at = pad4(bin.length)
  const gap = Buffer.alloc(at - bin.length, 0x00)
  const new_bin = Buffer.concat([bin, gap, new_png])
  bv.byteOffset = at
  bv.byteLength = new_png.length
  json.buffers[0].byteLength = new_bin.length
  return { json, bin: new_bin, w: src.width, h: src.height }
}

// ── run over each ambient decal mob ──────────────────────────────────────────────────────────────────────
let touched = 0
for (const [name, zip_path] of Object.entries(MOBS)) {
  const glb_path = resolve(MODELS_DIR, `${name}.glb`)
  if (!existsSync(glb_path)) {
    console.log(`  ✗ ${name}: no ${name}.glb`)
    continue
  }
  let vanilla_png
  try {
    vanilla_png = execSync(`unzip -p "${ASSETS_ZIP}" "${zip_path}"`, { maxBuffer: 1 << 24 })
    if (!vanilla_png?.length) throw new Error('empty')
  } catch (e) {
    console.log(`  ✗ ${name}: source skin unreadable (${zip_path}): ${e.message}`)
    continue
  }
  const { json, bin } = parse_glb(readFileSync(glb_path))
  let res
  try {
    res = process_glb(json, bin, vanilla_png)
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`)
    continue
  }
  if (!res) {
    console.log(`  – ${name}: no skin_decal, skipped`)
    continue
  }
  touched += 1
  console.log(
    `  ${DRY ? 'DRY ' : '✓ '}${name}: skin_decal reset to vanilla ${res.w}x${res.h} (original alpha, no feather/key)`
  )
  if (!DRY) writeFileSync(glb_path, write_glb(res.json, res.bin))
}
console.log(
  `${DRY ? '[dry] ' : ''}decal reset applied to ${touched} GLB(s). Remember to bump MODEL_VERSION in src/game/data/mobs.js.`
)
