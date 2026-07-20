#!/usr/bin/env node
// Batch-render the shop's wearable cosmetics on the production avatar. The render scene accepts explicit
// camera query parameters, so every mount slot is framed by shop_render_framing.mjs instead of sharing the
// full-body default. Run this before rebuilding and uploading the shop_render quilt.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { alpha_bbox, HEAD_PROBE, head_fit_params, within_margins } from './shop_head_autofit.mjs'
import { framing_for_slot, framing_search_params, worn_slot_for_category } from './shop_render_framing.mjs'
import { manifest_media_for_item } from './shop_render_manifest.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const frontend_dir = resolve(script_dir, '..')
const repo_dir = resolve(frontend_dir, '../..')
const engine_dir = resolve(repo_dir, 'packages/engine')
const equipment_dir = resolve(repo_dir, 'models/equipment')
const out_dir = resolve(repo_dir, 'scripts/walrus/out/shop_assets')
const worn_dir = resolve(out_dir, 'worn')
const thumb_size = 512
const hd_size = 1024

const webgpu_launch_options = Object.freeze({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'],
})

const element_variant_alias = Object.freeze({
  air: 'agility',
  earth: 'strength',
  fire: 'intelligence',
  water: 'chance',
})

function read_json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parse_cli_args(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) continue
    const next = argv[index + 1]
    args[argument.slice(2)] = next === undefined || next.startsWith('--') ? true : next
    if (args[argument.slice(2)] === next) index += 1
  }
  return args
}

function parse_glb_json(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) return null
  const json_length = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) return null
  try {
    return {
      json: JSON.parse(buffer.subarray(20, 20 + json_length).toString('utf8')),
      json_length,
    }
  } catch {
    return null
  }
}

function glb_variants(path) {
  if (!existsSync(path)) return []
  const parsed = parse_glb_json(readFileSync(path))
  const variants = parsed?.json?.extensions?.KHR_materials_variants?.variants
  return Array.isArray(variants) ? variants.map((variant) => String(variant?.name ?? '')).filter(Boolean) : []
}

function resolve_variant(path, skin) {
  if (!skin) return null
  const variants = glb_variants(path)
  if (variants.includes(skin)) return skin
  const alias = element_variant_alias[skin]
  return alias && variants.includes(alias) ? alias : skin
}

function bake_variant(buffer, variant_name) {
  if (!variant_name) return buffer
  const parsed = parse_glb_json(buffer)
  if (!parsed) return buffer
  const { json, json_length } = parsed
  const variants = json.extensions?.KHR_materials_variants?.variants ?? []
  const variant_index = variants.findIndex((variant) => String(variant?.name) === variant_name)
  if (variant_index < 0) return buffer

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mappings = primitive.extensions?.KHR_materials_variants?.mappings
      const match = mappings?.find(
        (mapping) => Array.isArray(mapping?.variants) && mapping.variants.includes(variant_index)
      )
      if (match && typeof match.material === 'number') primitive.material = match.material
      if (!primitive.extensions) continue
      delete primitive.extensions.KHR_materials_variants
      if (Object.keys(primitive.extensions).length === 0) delete primitive.extensions
    }
  }

  delete json.extensions.KHR_materials_variants
  if (Object.keys(json.extensions).length === 0) delete json.extensions
  json.extensionsUsed = (json.extensionsUsed ?? []).filter((extension) => extension !== 'KHR_materials_variants')
  if (json.extensionsUsed.length === 0) delete json.extensionsUsed
  if (json.extensionsRequired) {
    json.extensionsRequired = json.extensionsRequired.filter((extension) => extension !== 'KHR_materials_variants')
  }

  let json_bytes = Buffer.from(JSON.stringify(json), 'utf8')
  const padding = (4 - (json_bytes.length % 4)) % 4
  if (padding) json_bytes = Buffer.concat([json_bytes, Buffer.alloc(padding, 0x20)])
  const binary_tail = buffer.subarray(20 + json_length)
  const output = Buffer.alloc(20 + json_bytes.length + binary_tail.length)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(json_bytes.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  json_bytes.copy(output, 20)
  binary_tail.copy(output, 20 + json_bytes.length)
  return output
}

function resolve_worn_cosmetics() {
  const shop_path = resolve(repo_dir, 'seed/mainnet/shop.json')
  const rows = (read_json(shop_path).cosmetics ?? []).filter(
    (row) => row.category === 'hat' || row.category === 'cloak'
  )
  const distinct_by_key = new Map()

  for (const row of rows) {
    const skin = row.skin || null
    const glb = resolve(equipment_dir, `${row.appearance}.glb`)
    const variant = resolve_variant(glb, skin)
    const render_key = variant ? `${row.appearance}_${variant}` : row.appearance
    const existing = distinct_by_key.get(render_key)
    if (existing) {
      existing.slugs.push(row.slug)
      continue
    }
    distinct_by_key.set(render_key, {
      appearance: row.appearance,
      category: row.category,
      exists: existsSync(glb),
      glb,
      render_key,
      skin,
      slugs: [row.slug],
      variant,
    })
  }

  return { distinct: [...distinct_by_key.values()], rows }
}

function equipment_glb_plugin() {
  return {
    name: 'shop-assets-equipment-glb',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const request_url = request.url ?? ''
        if (!request_url.startsWith('/equipment/')) return next()
        const [path_part, query] = request_url.slice('/equipment/'.length).split('?')
        const relative_path = decodeURIComponent(path_part)
        if (!/^[a-z0-9_-]+\.glb$/i.test(relative_path)) {
          response.writeHead(400)
          return response.end('bad path')
        }
        const absolute_path = resolve(equipment_dir, relative_path)
        if (!existsSync(absolute_path)) {
          response.writeHead(404)
          return response.end('not found')
        }
        const variant = new URLSearchParams(query ?? '').get('variant') ?? ''
        response.writeHead(200, { 'content-type': 'model/gltf-binary' })
        if (!variant) return createReadStream(absolute_path).pipe(response)
        return response.end(bake_variant(readFileSync(absolute_path), variant))
      })
    },
  }
}

async function start_engine_vite_server(preferred_port = 5891) {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: engine_dir,
    configFile: false,
    logLevel: 'warn',
    assetsInclude: ['**/*.glb'],
    plugins: [equipment_glb_plugin()],
    server: { host: '127.0.0.1', port: preferred_port, strictPort: false },
  })
  await server.listen()
  const address = server.httpServer.address()
  const port = typeof address === 'string' ? preferred_port : address.port
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() }
}

function render_url(base, item, override = null) {
  const slot = worn_slot_for_category(item.category)
  const glb_query = item.variant ? `?variant=${encodeURIComponent(item.variant)}` : ''
  const glb_path = `/equipment/${item.appearance}.glb${glb_query}`
  const params = framing_search_params(slot)
  // Head renders auto-fit per hat: override only the dolly + vertical aim (keep the slot's orbit/face/seek).
  if (override) {
    params.set('camr', String(override.camera_radius))
    params.set('camy', String(override.camera_y))
    params.set('ty', String(override.target_y))
  }
  params.set('transparent', '1')
  params.set('head', slot === 'head' ? glb_path : '')
  params.set('back', slot === 'back' ? glb_path : '')
  return `${base}/demo/worn_cosmetics_showcase.html?${params}`
}

// Load the scene, freeze the live loop, and seek to the showcase pose. Shared by the probe + final passes.
async function pose_page(page, url, seek_seconds) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__ready === true, { timeout: 20_000 })
  await page.evaluate(() => window.__stop_live())
  await page.evaluate((seconds) => window.__seek(seconds), seek_seconds)
}

// Resolve the per-hat camera by measuring a wide probe render's real alpha (pixels are the oracle — the fit
// rides the true mount transform). Returns the fitted override, or null to use the slot default (cloaks /
// a blank probe). One radius-widen retry guards against a residual top-clip.
async function autofit_head_camera(page, base, item, seek_seconds, size) {
  await pose_page(page, render_url(base, item, HEAD_PROBE), seek_seconds)
  let bbox = alpha_bbox(await page.screenshot({ omitBackground: true }))
  if (!bbox) return null
  let fit = head_fit_params(bbox, size)
  await pose_page(page, render_url(base, item, fit), seek_seconds)
  bbox = alpha_bbox(await page.screenshot({ omitBackground: true }))
  if (!within_margins(bbox, size)) {
    fit = { ...fit, camera_radius: fit.camera_radius * 1.15 }
    await pose_page(page, render_url(base, item, fit), seek_seconds)
  }
  return fit
}

async function render_targets(targets) {
  if (targets.length === 0) return { failed: [], rendered: [] }
  const { base, close: close_server } = await start_engine_vite_server()
  let browser = null
  const failed = []
  const rendered = []

  try {
    browser = await chromium.launch(webgpu_launch_options)
    const page = await browser.newPage({ viewport: { height: hd_size, width: hd_size } })
    for (const item of targets) {
      const page_errors = []
      const on_page_error = (error) => page_errors.push(String(error))
      page.on('pageerror', on_page_error)
      try {
        const slot = worn_slot_for_category(item.category)
        const { seek_seconds } = framing_for_slot(slot)
        await page.setViewportSize({ height: hd_size, width: hd_size })
        // Hats auto-fit the camera per model (kills the tall-hat top-clip); cloaks keep the tuned back framing.
        const override = slot === 'head' ? await autofit_head_camera(page, base, item, seek_seconds, hd_size) : null
        await pose_page(page, render_url(base, item, override), seek_seconds)
        await page.screenshot({
          omitBackground: true,
          path: resolve(worn_dir, `${item.render_key}_hd.png`),
        })
        await page.setViewportSize({ height: thumb_size, width: thumb_size })
        await page.screenshot({
          omitBackground: true,
          path: resolve(worn_dir, `${item.render_key}.png`),
        })
        rendered.push(item.render_key)
      } catch (error) {
        failed.push({
          error: String(error?.message ?? error),
          page_errors: page_errors.slice(0, 2),
          render_key: item.render_key,
        })
      } finally {
        page.off('pageerror', on_page_error)
      }
    }
  } finally {
    await browser?.close()
    await close_server()
  }

  return { failed, rendered }
}

function update_manifest({ distinct, failed, renderable_keys, rendered, selected_keys }) {
  const manifest_path = resolve(out_dir, 'manifest.json')
  const manifest = existsSync(manifest_path) ? read_json(manifest_path) : {}
  const previous_slugs = manifest.worn?.slugs ?? {}
  const rendered_keys = new Set(rendered)
  const slugs = {}

  for (const item of distinct) {
    const selected = selected_keys.has(item.render_key)
    const renderable = renderable_keys.has(item.render_key)
    const rendered_now = rendered_keys.has(item.render_key)
    for (const slug of item.slugs) {
      const previous = previous_slugs[slug] ?? {}
      const media = manifest_media_for_item({ item, previous, renderable, rendered_now, selected })
      slugs[slug] = {
        appearance: item.appearance,
        category: item.category,
        png: media.png,
        png_hd: media.png_hd,
        render_key: item.render_key,
        skin: item.skin,
        variant: item.variant,
        video: media.video,
      }
    }
  }

  manifest.worn = {
    distinct_renders: distinct.length,
    failed: failed.length,
    failed_render_keys: failed,
    generated_at: new Date().toISOString(),
    missing_glb: distinct.filter((item) => !item.exists).length,
    missing_glb_render_keys: distinct.filter((item) => !item.exists).map((item) => item.render_key),
    rendered: rendered.length,
    requested: selected_keys.size,
    slugs,
    total_shop_rows: Object.keys(slugs).length,
  }
  writeFileSync(manifest_path, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest_path
}

async function main() {
  mkdirSync(worn_dir, { recursive: true })
  const args = parse_cli_args(process.argv.slice(2))
  const limit = args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY
  const only = args.only ? new Set(String(args.only).split(',')) : null
  const { distinct, rows } = resolve_worn_cosmetics()
  let selected = distinct
  if (only) {
    selected = selected.filter(
      (item) => only.has(item.render_key) || only.has(item.appearance) || item.slugs.some((slug) => only.has(slug))
    )
  }
  selected = selected.slice(0, limit)
  const selected_keys = new Set(selected.map((item) => item.render_key))
  const targets = selected.filter((item) => item.exists)
  const missing = selected.filter((item) => !item.exists)

  console.log(
    `${rows.length} shop cosmetic rows -> ${distinct.length} distinct renders; rendering ${targets.length}, missing ${missing.length} GLBs.`
  )
  if (missing.length) console.error('MISSING GLB:', JSON.stringify(missing.map((item) => item.render_key)))

  const { failed, rendered } = await render_targets(targets)
  const renderable_keys = new Set(targets.map((item) => item.render_key))
  const manifest_path = update_manifest({ distinct, failed, renderable_keys, rendered, selected_keys })
  console.log(`rendered ${rendered.length}/${targets.length}; ${failed.length} failed; ${missing.length} missing`)
  console.log(`output -> ${worn_dir}`)
  console.log(`manifest -> ${manifest_path}`)
  if (failed.length) console.error('FAILED:', JSON.stringify(failed.slice(0, 10)))
  process.exitCode = failed.length || missing.length ? 2 : 0
}

await main()
