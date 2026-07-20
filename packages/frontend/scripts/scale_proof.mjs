#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// scale_proof.mjs — the "scale ruler" screenshot for the ambient-mob retune (regression: mobs read too small).
// Renders the PLAYER character (senshi_male.glb, normalized to CHARACTER_HEIGHT=1.5 blocks exactly as the
// engine does) standing beside ambient mobs scaled to their NEW SPAWN_TABLE target_h (blocks) — the player
// is the ruler. Grounded (feet at y=0), gameplay third-person-ish distance. → /tmp/mob_scale_proof.png

import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(__dirname, '..')
const THREE = resolve(FRONTEND, 'node_modules/three')
const MOBS = resolve(FRONTEND, 'public/sprites/mobs/models')
const CHAR = resolve(FRONTEND, '../engine/assets/characters/senshi_male.glb')
const CHARACTER_HEIGHT = 1.5

// player + the size extremes from the retuned SPAWN_TABLE: lamb 1.3 (tallest), tortoise 1.0, bunny 0.72, mouse 0.44 (shortest)
const CAST = [
  { file: CHAR, label: 'PLAYER 1.5', target_h: CHARACTER_HEIGHT, x: 0, player: true },
  { file: resolve(MOBS, 'lamb.glb'), label: 'lamb 1.3', target_h: 1.3, x: 1.4 },
  { file: resolve(MOBS, 'tortoise.glb'), label: 'tortoise 1.0', target_h: 1.0, x: 2.7 },
  { file: resolve(MOBS, 'bunny.glb'), label: 'bunny 0.72', target_h: 0.72, x: -1.3 },
  { file: resolve(MOBS, 'mouse.glb'), label: 'mouse 0.44', target_h: 0.44, x: -2.3 },
]

const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' }
let render_html = ''
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/' || p === '/render.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(render_html)
  let fp
  const idx = CAST.findIndex((c, i) => p === '/m' + i + '.glb')
  if (idx >= 0) fp = CAST[idx].file
  else if (p.startsWith('/three/')) fp = resolve(THREE, p.slice('/three/'.length))
  else return res.writeHead(404).end('404')
  if (!existsSync(fp) || !statSync(fp).isFile()) return res.writeHead(404).end('404')
  res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' }).end(readFileSync(fp))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const html = `<!doctype html><meta charset=utf8><canvas id=c width=1000 height=620></canvas>
<script type=importmap>{"imports":{"three":"${base}/three/build/three.module.js","three/addons/":"${base}/three/examples/jsm/"}}</script>
<script type=module>
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
const CAST = ${JSON.stringify(CAST.map((c, i) => ({ url: base + '/m' + i + '.glb', target_h: c.target_h, x: c.x, player: !!c.player, label: c.label })))}
const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true })
renderer.setClearColor(0x1a2230); renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0
const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xfff6e8, 0x445566, 1.2))
const dl = new THREE.DirectionalLight(0xfff2df, 1.7); dl.position.set(4, 8, 6); scene.add(dl)
// ground + 1-block grid so heights read against unit blocks
const grid = new THREE.GridHelper(20, 20, 0x33465e, 0x28374a); scene.add(grid)
const cam = new THREE.PerspectiveCamera(42, 1000/620, 0.01, 100)
const loader = new GLTFLoader()
const draco = new DRACOLoader(); draco.setDecoderPath('${base}/three/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco)
let done = 0
for (const m of CAST) {
  loader.load(m.url, g => {
    const root = g.scene
    const b0 = new THREE.Box3().setFromObject(root)
    const h = (b0.max.y - b0.min.y) || 1
    root.scale.setScalar(m.target_h / h)           // EXACT engine math: scale to target_h blocks
    const b1 = new THREE.Box3().setFromObject(root) // reground: feet to y=0
    root.position.y -= b1.min.y
    root.position.x = m.x
    root.rotation.y = Math.PI * 0.15
    root.traverse(o => { if (o.isMesh) for (const mm of (Array.isArray(o.material)?o.material:[o.material])) if (mm && mm.metalness>0) mm.metalness=0 })
    scene.add(root)
    if (++done === CAST.length) finish()
  }, undefined, e => { (window.__err ??= []).push(String(e)); if (++done === CAST.length) finish() })
}
function finish() {
  // gameplay third-person-ish: behind/above, framing the whole line-up, player torso as look target
  cam.position.set(0.2, 2.1, 6.4); cam.lookAt(0, 0.9, 0)
  renderer.render(scene, cam)
  window.__done = true
}
</script>`

render_html = html
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(base + '/render.html', { waitUntil: 'load' })
await page.waitForFunction(() => window.__done, { timeout: 20000 }).catch(() => {})
const err = await page.evaluate(() => window.__err || null)
const out = '/tmp/mob_scale_proof.png'
await page.screenshot({ path: out })
await browser.close()
server.close()
console.log(
  'scale proof →',
  out,
  '| load errors:',
  err ? JSON.stringify(err) : 'none',
  errs.length ? errs.slice(0, 3) : ''
)
process.exit(0)
