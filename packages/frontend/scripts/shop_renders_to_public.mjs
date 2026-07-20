#!/usr/bin/env node
// shop_renders_to_public.mjs — publish the already-rendered shop worn-cosmetic PNGs into the frontend's
// SHIPPED static tree (packages/frontend/public/shop/<slug>.png), so the shop vitrine cards show the real
// "example character wearing it" render with ZERO CDN/Walrus dependency.
//
// WHY THIS EXISTS: render_worn_cosmetics.mjs renders every shop cosmetic into scripts/walrus/out/shop_assets/
// worn/<render_key>.png and writes a manifest — but those bytes are destined for the Walrus/assets CDN
// (shop_vitrine.tsx `shop_asset_url` → `${ASSETS_URL}/shop_assets/…`), which stays 404 until an upload lands.
// Only the "worn render incoming" mannequin ever displayed, because the renders were produced but never served
// same-origin. This copies the manifest's per-slug render into public/shop/, which Vite serves at
// `/shop/<slug>.png` in dev AND ships in dist/ for prod — the vitrine's `local_worn_url(slug)` reads it
// directly (a missing file 404s to the existing mannequin fallback). Re-run after render_worn_cosmetics.mjs.
//
// Source of truth for the slug↔file mapping is the manifest (never re-derived): render_key == slug in this
// catalog, but keying off `worn.slugs[slug].png` survives any future dedupe change for free.
//
// USAGE (from packages/frontend):  node scripts/shop_renders_to_public.mjs
//   --hd   copy the 1024 render (png_hd) instead of the default 512 thumb (bigger, crisper)

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(__dirname, '..')
const REPO = resolve(FRONTEND, '../..')
const OUT_DIR = resolve(REPO, 'scripts/walrus/out/shop_assets')
const PUBLIC_SHOP = resolve(FRONTEND, 'public/shop')

const USE_HD = process.argv.includes('--hd')

const manifest_path = resolve(OUT_DIR, 'manifest.json')
if (!existsSync(manifest_path)) {
  console.error(`no manifest at ${manifest_path} — run scripts/render_worn_cosmetics.mjs first`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifest_path, 'utf8'))
const slugs = manifest.worn?.slugs ?? {}

mkdirSync(PUBLIC_SHOP, { recursive: true })
const copied = []
const skipped = []
for (const [slug, entry] of Object.entries(slugs)) {
  const rel = USE_HD ? entry.png_hd : entry.png // 'worn/<key>.png'
  if (!rel) {
    skipped.push(slug) // render failed or GLB missing — the card keeps its mannequin placeholder
    continue
  }
  const src = resolve(OUT_DIR, rel)
  if (!existsSync(src)) {
    skipped.push(slug)
    continue
  }
  const dest = resolve(PUBLIC_SHOP, `${slug}.png`)
  copyFileSync(src, dest)
  copied.push(basename(dest))
}

console.log(`✓ published ${copied.length} worn renders → ${PUBLIC_SHOP}  (${USE_HD ? '1024 hd' : '512 thumb'})`)
if (skipped.length) console.log(`  skipped (no render — mannequin placeholder stays): ${skipped.join(', ')}`)
