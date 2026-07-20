#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// repro_mob_freeze.mjs — REAL-ENGINE reproduction of the "world freezes when a mob enters the frustum"
// P0. Boots the ACTUAL engine demo (create_engine → full atmosphere/post/shadow/voxel-terrain pipeline)
// headless on real Metal, injects ONE mob GLB via the engine's OWN loader path (get_glb_loader +
// apply_avatar_material + add_to_scene — identical to ambient_mobs.spawn_rig), glues it in front of the
// camera, drives the camera so the shadow box recenters, and captures the per-frame console throw.
//
// PRECOND: engine demo vite running on :5267 (bun x vite --port 5267 in packages/engine).
// USAGE: node scripts/repro_mob_freeze.mjs --model bunny [--seconds 25]

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = resolve(__dirname, '..', 'public/sprites/mobs/models')
const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!a.startsWith('--')) continue
  const nx = process.argv[i + 1]
  args[a.slice(2)] = nx === undefined || nx.startsWith('--') ? true : process.argv[++i]
}
const model = String(args.model ?? 'bunny')
const glb_path = args.glb ? resolve(String(args.glb)) : resolve(MODELS_DIR, model + '.glb')
if (!existsSync(glb_path)) {
  console.error('glb not found:', glb_path)
  process.exit(1)
}
const SECONDS = Number(args.seconds ?? 25)
const DEMO = 'http://localhost:5267/demo/'

// tiny CORS server so the in-page GLTFLoader can fetch the mob GLB cross-origin from the demo origin
const glb_bytes = readFileSync(glb_path)
const cors = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'model/gltf-binary', 'access-control-allow-origin': '*' }).end(glb_bytes)
})
await new Promise((r) => cors.listen(0, '127.0.0.1', r))
const GLB_URL = `http://127.0.0.1:${cors.address().port}/mob.glb`

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => {
  const t = m.type()
  if (t === 'error' || t === 'warning') errors.push(`[${t}] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)))

if (args.nomob)
  await page.addInitScript(() => {
    window.__NOMOB = true
  })
if (args['shared-dispose'])
  await page.addInitScript(() => {
    window.__SHARED = true
  })
if (args['shared-nodispose'])
  await page.addInitScript(() => {
    window.__SHARED = true
    window.__NODISPOSE = true
  })
await page.goto(DEMO, { waitUntil: 'load' })
// wait for engine boot + terrain resident
const booted = await page
  .waitForFunction(
    () => {
      const e = window.__engine
      if (!e || !e.get_camera || !e.get_camera()) return false
      const s = e.get_stats ? e.get_stats() : null
      return s && s.renderer_backend === 'webgpu' && (s.quads > 0 || s.draw_calls > 0)
    },
    { timeout: 45000 }
  )
  .then(() => true)
  .catch(() => false)
const boot_info = await page.evaluate(() => {
  const e = window.__engine,
    s = e && e.get_stats && e.get_stats()
  return {
    backend: s && s.renderer_backend,
    quads: s && s.quads,
    cam: e && e.get_camera() ? [e.get_camera().position.x, e.get_camera().position.y, e.get_camera().position.z] : null,
  }
})
console.log('booted=', booted, 'engine=', JSON.stringify(boot_info))

// inject the mob via the engine's OWN loader path, glue it in front of the camera, drive the camera
const inj = await page.evaluate(
  async ({ GLB_URL }) => {
    const out = { steps: [], err: null }
    try {
      // the engine's REAL mob-rig loader (the fight board's path): clone + scale + apply_avatar_material +
      // AnimationMixer auto-playing IDLE + castShadow. Zero bare-three imports (three objects come out of it).
      const player = await import('/src/player/character_controller.js')
      out.steps.push('import ok; create_character_avatar=' + typeof player.create_character_avatar)
      const e = window.__engine
      const NOMOB = window.__NOMOB === true
      const SHARED = window.__SHARED === true
      let av = null
      if (SHARED) {
        // ── replicate ambient_mobs.js EXACTLY: module-cached GLB → SkeletonUtils/Object3D clone (SHARES
        //    materials + geometry across rigs) → drop_rig disposes those SHARED resources same-frame. ──
        const gltf = await player.get_glb_loader().loadAsync(GLB_URL) // the module-cached parse (one gltf, shared mats/geom)
        const mk = () => {
          const c = gltf.scene.clone()
          player.apply_avatar_material(c)
          c.traverse((o) => {
            if (o.isMesh) o.castShadow = true
          })
          c.scale.setScalar(0.35)
          return c
        }
        const keep = mk() // stays VISIBLE (glued in front of the camera)
        const doomed = mk() // will be dropped (drop_rig) — disposes the SHARED material/geometry `keep` also uses
        e.add_to_scene(keep)
        e.add_to_scene(doomed)
        out.steps.push('SHARED: 2 clones added (shared mats/geom)')
        const cam = e.get_camera()
        doomed.position.set(cam.position.x, cam.position.y - 2, cam.position.z + 3)
        const fwd0 = cam.position.clone()
        // after ~2 s, run drop_rig on `doomed` EXACTLY as ambient_mobs.js does (remove + same-frame dispose)
        const NODISPOSE = window.__NODISPOSE === true
        setTimeout(() => {
          try {
            e.remove_from_scene(doomed)
          } catch {
            /* doomed may already be gone — repro is best-effort */
          }
          if (!NODISPOSE)
            doomed.traverse((o) => {
              o.geometry?.dispose?.()
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose?.()
            })
          window.__dropped = true
          out.steps.push(
            NODISPOSE
              ? 'SHARED: FIX — removed only, shared resources kept'
              : 'SHARED: drop_rig disposed the shared material/geometry'
          )
        }, 2000)
        let last = performance.now()
        window.__repro_alive = 0
        let frame = 0
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000)
          last = now
          frame++
          cam.getWorldDirection(fwd0)
          keep.position.set(cam.position.x + fwd0.x * 5, cam.position.y + fwd0.y * 5 - 0.6, cam.position.z + fwd0.z * 5)
          keep.rotation.y += 0.01
          window.__repro_alive = frame
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
        out.steps.push('SHARED drive loop started')
        return out
      }
      if (!NOMOB) {
        av = player.create_character_avatar({ glb_url: GLB_URL, scale: 0.35, cast_shadow: true })
        e.add_to_scene(av.object3d)
        out.steps.push('avatar created + added to scene')
        await new Promise((r) => {
          const t = setInterval(() => {
            if (av.ready) {
              clearInterval(t)
              r()
            }
          }, 50)
          setTimeout(() => {
            clearInterval(t)
            r()
          }, 8000)
        })
        out.steps.push('avatar.ready=' + av.ready)
      } else out.steps.push('NOMOB control — no avatar injected')
      // drive: glue the mob ~5 m in front of the camera each frame (always in frustum) + pan/translate the
      // camera across chunk boundaries so the sun shadow box recenters (mob re-renders in the shadow depth pass).
      const cam = e.get_camera()
      const start = [cam.position.x, cam.position.y, cam.position.z]
      const fwd = cam.position.clone() // an engine-three Vector3 (no import)
      let last = performance.now(),
        frame = 0
      window.__repro_alive = 0
      const loop = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        frame++
        if (av) {
          av.tick(dt)
          cam.getWorldDirection(fwd)
          av.object3d.position.set(
            cam.position.x + fwd.x * 5,
            cam.position.y + fwd.y * 5 - 0.6,
            cam.position.z + fwd.z * 5
          )
          av.object3d.rotation.y += 0.01
        }
        window.__repro_alive = frame
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
      out.steps.push('drive loop started')
    } catch (err) {
      out.err = String((err && err.stack) || err)
    }
    return out
  },
  { GLB_URL }
)
console.log('inject:', JSON.stringify(inj, null, 1))

// FREEZE ORACLE = the engine's OWN frame stats over time (fps / draw_calls). Drive REAL movement
// (hold W + pan) so we replicate the "moving while a mob is visible" freeze condition — camera-chunk
// crossings recenter the sun shadow box, the mob stays glued in front (always in frustum). A freeze =
// fps → ~0 while the driver rAF keeps advancing (the "world static, nametags still rotate" signature).
await page.mouse.move(450, 350)
await page.keyboard.down('KeyW')
const series = []
for (let s = 0; s < SECONDS; s++) {
  await new Promise((r) => setTimeout(r, 1000))
  // wiggle the view each second so the camera keeps crossing chunk boundaries (shadow recenter)
  await page.mouse.move(450 + (s % 2 ? 120 : -120), 350).catch(() => {})
  const st = await page
    .evaluate(() => {
      const e = window.__engine,
        g = e.get_stats()
      return { fps: g.fps, draws: g.draw_calls, xyz: g.camera_position, frames: window.__repro_alive || 0 }
    })
    .catch(() => null)
  if (st) series.push(st)
}
await page.keyboard.up('KeyW')
await page.screenshot({ path: `/tmp/repro_${model}.png` })
await browser.close()
cors.close()

const NOISE =
  /Download the .*DevTools|favicon|Failed to load resource|has been deprecated|renderAsync|\[vite\]|Lit is in dev mode|lil-gui/i
const real = [...new Set(errors)].filter((e) => !NOISE.test(e))
console.log('\n=== REPRO RESULT:', model, args.nomob ? '(NO MOB CONTROL)' : '', '===')
console.log('fps/draws/xyz/driver-frames per second:')
for (const s of series)
  console.log(`  fps=${s.fps}  draws=${s.draws}  xyz=${JSON.stringify(s.xyz)}  driverFrames=${s.frames}`)
const fpsvals = series.map((s) => s.fps)
const minfps = Math.min(...fpsvals),
  moved = series.length > 1 && JSON.stringify(series[0].xyz) !== JSON.stringify(series[series.length - 1].xyz)
console.log('min fps:', minfps, '| camera moved:', moved, minfps < 5 ? '  ⟵ FROZEN (fps≈0)' : '')
console.log('screenshot: /tmp/repro_' + model + '.png')
if (real.length) {
  console.log('REAL ERRORS:')
  for (const e of real.slice(0, 12)) console.log(' ✗', e)
} else console.log('no non-noise console errors captured')
process.exit(real.length || minfps < 5 ? 2 : 0)
