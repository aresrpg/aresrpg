#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Batch-render the encyclopedia mob icons (MinIO `mobs/`: {catalog-key}.png + {catalog-key}_hd.png). Recreates the
// asset-publishing pipeline already references. Each creature GLB is loaded through the REAL
// game render SDK (packages/engine/src/player/mob_model.js → create_mob_model: the shared DRACO/GLTF loader,
// the metalness gold-kill, the S-82 pixel-art sampler, the mob-shade emissive floor), so an icon matches the
// FIXED fight/roam look — the old quilt was rendered before those fixes ("buggy texture"). The camera
// auto-fits each model's real scaled bounds (whole model + margin, any silhouette), the hat-fix standard.
//
// Serves mob_icon_showcase.html from the engine Vite root (three / mob_model.js / /draco all resolve there)
// and the mob GLBs from the frontend public dir via middleware. WebGPU headless Chromium screenshots
// transparent PNGs. Pixels are the oracle: alpha_bbox verifies the whole model sits inside the frame margins;
// a residual clip widens the fit once.
//
// Usage: bun packages/frontend/scripts/render_mob_icons.mjs [--catalog FILE] [--missing] [--only key,glb]
//        [--limit N] [--out DIR] [--list FILE]. A catalog is mandatory (default: scratchpad/mob_catalog.json):
//        without the key→GLB join a renderer cannot prove that the filenames the client asks for were written.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { assert_mob_icon_publish_complete, mob_icon_publish_plan } from '../src/game/data/mob_icon_name.js'

import { alpha_bbox } from './shop_head_autofit.mjs'

const script_dir = dirname(fileURLToPath(import.meta.url))
const frontend_dir = resolve(script_dir, '..')
const repo_dir = resolve(frontend_dir, '../..')
const engine_dir = resolve(repo_dir, 'packages/engine')
const models_dir = resolve(frontend_dir, 'public/sprites/mobs/models')
const scratch_dir = process.env.ARES_TEST_OUT ?? resolve(frontend_dir, 'test-results/out')
const default_out = resolve(scratch_dir, 'vismobs/renders')
const default_catalog = resolve(scratch_dir, 'mob_catalog.json')
const thumb_size = 512
const hd_size = 1024
const seek_seconds = 0.35 // hold a mid-idle frame (natural limb/wing spread; static if the GLB has no clips)
const margin_frac = 0.03

const webgpu_launch_options = Object.freeze({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist'],
})

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

function publish_inputs(args) {
  const catalog_path = String(args.catalog ?? default_catalog)
  if (!existsSync(catalog_path))
    throw new Error(`mob icon publish is unverifiable: catalog not found at ${catalog_path}`)
  const catalog = JSON.parse(readFileSync(catalog_path, 'utf8'))
  const full_plan = mob_icon_publish_plan(catalog)
  if (!full_plan.length) throw new Error(`mob icon publish is unverifiable: ${catalog_path} has no renderable rows`)

  let requested = null
  if (args.list) requested = readFileSync(String(args.list), 'utf8').split(/\s+/).filter(Boolean)
  else if (args.only) requested = String(args.only).split(',').filter(Boolean)
  else if (args.missing) {
    const probe = JSON.parse(readFileSync(resolve(scratch_dir, 'asset_probe.json'), 'utf8'))
    if (!Array.isArray(probe.missing)) throw new TypeError('asset_probe.json is missing its missing[] field')
    requested = probe.missing
  }
  const wanted = requested
    ? new Set(requested.map((value) => value.replace(/_hd\.png$/i, '').replace(/\.(glb|png)$/i, '')))
    : null
  let plan = wanted ? full_plan.filter(({ key, glb }) => wanted.has(key) || wanted.has(glb)) : full_plan
  if (wanted && !plan.length) throw new Error('mob icon publish selection matched no catalog key or GLB')

  let glbs = [...new Set(plan.map(({ glb }) => glb))]
  if (args.limit) glbs = glbs.slice(0, Number(args.limit))
  const selected = new Set(glbs)
  plan = plan.filter(({ glb }) => selected.has(glb))
  const missing_models = glbs.filter((glb) => !existsSync(resolve(models_dir, `${glb}.glb`)))
  if (missing_models.length)
    throw new Error(
      `mob icon publish is unverifiable: ${missing_models.length} GLB(s) missing: ${missing_models.slice(0, 8).join(', ')}`
    )
  return {
    glbs,
    plan,
    selected_catalog: Object.fromEntries(plan.map(({ key, glb }) => [key, { glb }])),
  }
}

function mob_glb_plugin() {
  return {
    name: 'mob-icon-glb',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? ''
        if (!url.startsWith('/mobglb/')) return next()
        const rel = decodeURIComponent(url.slice('/mobglb/'.length).split('?')[0])
        if (!/^[a-z0-9_.-]+\.glb$/i.test(rel)) {
          response.writeHead(400)
          return response.end('bad path')
        }
        const abs = resolve(models_dir, rel)
        if (!existsSync(abs)) {
          response.writeHead(404)
          return response.end('not found')
        }
        response.writeHead(200, { 'content-type': 'model/gltf-binary' })
        return createReadStream(abs).pipe(response)
      })
    },
  }
}

async function start_engine_vite_server(preferred_port = 5893) {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: engine_dir,
    configFile: false,
    logLevel: 'warn',
    assetsInclude: ['**/*.glb'],
    plugins: [mob_glb_plugin()],
    server: { host: '127.0.0.1', port: preferred_port, strictPort: false },
  })
  await server.listen()
  const address = server.httpServer.address()
  const port = typeof address === 'string' ? preferred_port : address.port
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() }
}

const scene_params = {} // tone/expo/yaw passthrough (set in main from CLI)
function render_url(base, glb, fill) {
  const params = new URLSearchParams({ glb: `/mobglb/${glb}.glb`, transparent: '1', ...scene_params })
  if (fill != null) params.set('fill', String(fill))
  return `${base}/demo/mob_icon_showcase.html?${params}`
}

async function pose(page, url) {
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__ready === true || window.__fatal, { timeout: 25_000 })
  const fatal = await page.evaluate(() => window.__fatal || null)
  if (fatal) throw new Error(`scene fatal: ${fatal}`)
  await page.evaluate((s) => window.__seek(s), seek_seconds)
}

// Whole model inside the frame margins? (all four edges — a mob icon must never clip.)
function within_margins(bbox, size) {
  if (!bbox) return false
  const m = Math.round(size * margin_frac)
  return bbox.t >= m && bbox.l >= m && bbox.b <= size - m && bbox.r <= size - m
}

async function render_targets(glbs, out_dir, plan) {
  const { base, close: close_server } = await start_engine_vite_server()
  let browser = null
  const failed = []
  const rendered = []
  const aliases = new Map()
  for (const row of plan) {
    const files = aliases.get(row.glb) ?? { thumb: [], hd: [] }
    files.thumb.push(row.thumb)
    files.hd.push(row.hd)
    aliases.set(row.glb, files)
  }
  try {
    browser = await chromium.launch(webgpu_launch_options)
    const page = await browser.newPage({ viewport: { height: hd_size, width: hd_size } })
    for (const glb of glbs) {
      const page_errors = []
      const on_err = (e) => page_errors.push(String(e))
      page.on('pageerror', on_err)
      try {
        await page.setViewportSize({ height: hd_size, width: hd_size })
        await pose(page, render_url(base, glb))
        let png = await page.screenshot({ omitBackground: true })
        let bbox = alpha_bbox(png)
        if (!bbox) throw new Error('empty render (no alpha) — model did not draw')
        // One widen retry if the silhouette clips a margin (a very wide/tall mob).
        if (!within_margins(bbox, hd_size)) {
          await pose(page, render_url(base, glb, 0.7))
          png = await page.screenshot({ omitBackground: true })
          bbox = alpha_bbox(png)
        }
        const files = aliases.get(glb)
        if (!files) throw new Error(`mob icon publish plan has no aliases for GLB "${glb}"`)
        for (const filename of files.hd) writeFileSync(resolve(out_dir, filename), png)
        await page.setViewportSize({ height: thumb_size, width: thumb_size })
        await page.evaluate((s) => window.__seek(s), seek_seconds)
        const thumb = await page.screenshot({ omitBackground: true })
        for (const filename of files.thumb) writeFileSync(resolve(out_dir, filename), thumb)
        rendered.push({ glb, files: [...files.thumb, ...files.hd], bbox_margin: within_margins(bbox, hd_size) })
      } catch (error) {
        failed.push({ glb, error: String(error?.message ?? error), page_errors: page_errors.slice(0, 2) })
      } finally {
        page.off('pageerror', on_err)
      }
    }
  } finally {
    await browser?.close()
    await close_server()
  }
  return { failed, rendered }
}

async function main() {
  const args = parse_cli_args(process.argv.slice(2))
  const out_dir = args.out ? resolve(String(args.out)) : default_out
  mkdirSync(out_dir, { recursive: true })
  for (const k of ['tone', 'expo', 'yaw']) if (args[k] != null && args[k] !== true) scene_params[k] = String(args[k])

  const { glbs, plan, selected_catalog } = publish_inputs(args)

  console.log(`rendering ${glbs.length} mob icons -> ${out_dir}`)
  const { failed, rendered } = await render_targets(glbs, out_dir, plan)
  const clipped = rendered.filter((r) => !r.bbox_margin).map((r) => r.glb)
  console.log(`rendered ${rendered.length}/${glbs.length}; ${failed.length} failed; ${clipped.length} still tight`)
  if (clipped.length) console.warn('TIGHT (widened, verify):', JSON.stringify(clipped.slice(0, 20)))
  if (failed.length) console.error('FAILED:', JSON.stringify(failed.slice(0, 10)))
  assert_mob_icon_publish_complete(
    selected_catalog,
    rendered.flatMap(({ files }) => files)
  )
  writeFileSync(
    resolve(out_dir, '_render_report.json'),
    `${JSON.stringify({ generated_at: new Date().toISOString(), rendered, failed, clipped }, null, 2)}\n`
  )
  process.exitCode = failed.length ? 2 : 0
}

await main()
