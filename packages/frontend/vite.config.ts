// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { resolve_app_version } from './src/resolve_app_version.mjs'

// CONTENT AUTHORING lives with the private authoring tree — its vite middlewares (local
// content, cosmetic GLB linking, move-hash, the seed-derived catalog) never ship here. The
// virtual catalog resolves to a LOUD empty fallback: the encyclopedia's slug/stat maps degrade
// to their miss paths until the published-catalog artifact lands (the content-seam ticket
// upgrades this resolver to read the committed artifact).
// The engine's default avatar rig (a heritage-derived GLB) never ships in git — it serves from
// the app's asset route at runtime (the CDN seam). This resolver maps the engine's ?url import
// to that route; absent the asset, the avatar loader errors LOUDLY (the debug-cube class).
const avatar_url_plugin = {
  name: 'default-avatar-cdn-url',
  resolveId(id: string) {
    return id.endsWith('assets/characters/senshi_male.glb?url') ? '\0avatar-url' : undefined
  },
  load(id: string) {
    return id === '\0avatar-url' ? "export default '/sprites/characters/senshi_male.glb'" : undefined
  },
}

const catalog_fallback_plugin = {
  name: 'item-catalog-empty-fallback',
  resolveId(id: string) {
    return id === 'virtual:item_catalog' ? '\0virtual:item_catalog' : undefined
  },
  load(id: string) {
    if (id !== '\0virtual:item_catalog') return undefined
    console.warn(
      '[item-catalog] virtual:item_catalog resolves EMPTY (published catalog artifact pending — encyclopedia maps degrade to miss paths)'
    )
    return 'export const slugs = []\nexport const pet_food_slugs = []\nexport const catalog = {}\n'
  },
}

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// D260 fix (v1.12.37 prod incident): deployed version string for the sidebar/badge tag is ALWAYS
// package.json's version — see src/resolve_app_version.mjs for the incident writeup. The old
// `git describe --tags --always` fallback (removed here) silently returned a raw commit SHA on
// Vercel's tag-less remote build, which shipped as `VE771893` instead of a semver.
const APP_VERSION = resolve_app_version(pkg.version)

// The exact git sha, injected as the Sentry release (core/report.js) so every reported error pins the
// commit it fired from. Falls back to pkg.version on a git-less build. Support/debugging concern only —
// unlike APP_VERSION above, GIT_SHA is never shown to players, so a raw commit hash here is correct, not a bug.
const GIT_SHA =
  process.env.APP_VERSION ||
  (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim()
    } catch {
      return pkg.version
    }
  })()

// DEV-only VFX-LAB capture endpoint (canon 33): `/__vfx_capture` writes a recorded webm to /tmp
// (so the CTO can batch-capture demos). `apply: 'serve'` ⇒ it never exists in a production build.
function vfx_lab_dev_plugin(): import('vite').Plugin {
  const read_body = (req: import('http').IncomingMessage): Promise<Buffer> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c as Buffer))
      req.on('end', () => resolve(Buffer.concat(chunks)))
    })
  return {
    name: 'ares-vfx-lab-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (req.method === 'POST' && url.startsWith('/__vfx_capture')) {
          const buf = await read_body(req)
          const raw = new URLSearchParams(url.split('?')[1] ?? '').get('name') ?? 'effect'
          const name = raw.replace(/[^a-z0-9_-]/gi, '_')
          const path = `/tmp/ares-vfx-${name}-${Date.now()}.webm`
          writeFileSync(path, buf)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ path, bytes: buf.length }))
          return
        }
        next()
      })
    },
  }
}

// [P0 balloon 2026-07-11] DEV-ONLY: replace every transformed module's inline source map with an empty
// one (same plugin as packages/engine/vite.config.js — see the full rationale there). Vite dev inlines
// maps as base64 `data:` URIs retained by V8 in EVERY realm loading the module; the dapp serves the
// engine's gen-worker graph, so on a 16-core machine the maps alone cost ~600 MB of renderer RSS — a
// big slice of the tab-killing OOM (real Aw-Snaps in dev). `apply: 'serve'` ⇒ absent from prod builds
// (which already set build.sourcemap: false). Opt back in with ARES_DEV_SOURCEMAPS=1 when debugging.
function strip_dev_sourcemaps(): import('vite').Plugin {
  return {
    name: 'ares:strip-dev-sourcemaps',
    apply: 'serve',
    enforce: 'post',
    transform(code) {
      return { code, map: { version: 3, sources: [], sourcesContent: [], names: [], mappings: '' } }
    },
  }
}

export default defineConfig({
  // D155: ONE three instance forever (dual = instanceof/backend breakage)
  resolve: { dedupe: ['three', 'three/webgpu'] },
  plugins: [
    ...(process.env.ARES_DEV_SOURCEMAPS ? [] : [strip_dev_sourcemaps()]),
    react(),
    tailwindcss(),
    vfx_lab_dev_plugin(),
    catalog_fallback_plugin, // virtual:item_catalog — see the content-authoring note above
    avatar_url_plugin, // default rig via the runtime asset route (heritage GLBs never in git)
    // The vendored game engine + @koshi/protocol's create_client use node
    // `stream` (PassThrough) + `events` (EventEmitter) + `buffer`; polyfill for the browser.
    nodePolyfills({ include: ['stream', 'events', 'buffer', 'process', 'util'] }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // autoUpdate already implies both flags; keep them explicit so every new worker activates and claims
        // open tabs promptly instead of waiting for every old tab to close.
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // [PRECACHE DIET, PERF_MOBILE_PLAN C4 pulled forward 2026-07-14] Precache ONLY the boot shell —
        // the old '**/*.{js,...}' glob installed EVERY hashed chunk (~21 MB) into CacheStorage on first
        // visit, hammering phones during the exact window they're drowning (iPhone trace: wedged from
        // t=0). Entry + css stay precached; every lazy chunk is fetched (and HTTP-cached) on demand — a SW
        // cache miss is a normal network fetch, never a failure.
        // HTML must never ride the immutable precache: an old worker would keep returning an old index whose
        // hashed chunks disappear on the next Vercel deploy. Navigations fetch/revalidate before cache fallback.
        globPatterns: ['assets/index-*.{js,css}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && url.pathname !== '/discord-callback.html',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigation-shell',
              cacheableResponse: { statuses: [200] },
            },
          },
          // MinIO asset host (#650 — full pivot off asset-host for serving): item/spell/mob/cosmetic/character
          // PNGs, GLBs, music mp3s, and the runtime /data/*.json content blobs all serve from this one origin
          // now (packages/sdk/src/jobs.js asset_url). It's already Cloudflare-tunnel-fronted, so SWR
          // mirrors that edge TTL client-side rather than fighting it — the SW never revalidates faster.
          {
            urlPattern: /^https:\/\/assets\.aresrpg\.world\/.+/,
            handler: 'StaleWhileRevalidate',
            options: {
              // #1598 — the cache matches by URL only, so whichever mode asked first won for everyone: one
              // no-cors `<img>` load stored an OPAQUE response, and every later cors consumer (Three.js
              // crossorigin textures, programmatic fetch) got it back and threw `Failed to fetch` →
              // net::ERR_FAILED, for up to maxAgeSeconds and across SW updates. Fetching in cors mode (the
              // host sends ACAO) stores a CORS-clean response, which satisfies cors AND no-cors consumers.
              cacheName: 'cdn-assets-v2', // bumped so already-poisoned clients abandon the old cache
              fetchOptions: { mode: 'cors' },
              cacheableResponse: { statuses: [200] }, // never cache an opaque or failed response
              expiration: { maxEntries: 800, maxAgeSeconds: 86400 },
            },
          },
        ],
      },
      manifest: {
        name: 'AresRPG',
        short_name: 'AresRPG',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        description:
          'Web companion for AresRPG — manage characters, browse the encyclopedia, and explore the world of AresRPG.',
        display: 'standalone',
        icons: [
          { src: '/logo-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // D260 fix: version shown in the sidebar/badge = package.json's `version`, always — the release
  // ritual bumps it, so it's static and present in every build (local/CI/Vercel), never derived
  // from git state. See src/resolve_app_version.mjs for the v1.12.37 SHA-leak incident this replaced.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_SHA__: JSON.stringify(GIT_SHA),
    // #73 — the deployment environment for the non-production wallet-connect gate (Vercel VERCEL_ENV:
    // 'production' | 'preview' | 'development'; '' when building outside Vercel). Injected at build time so
    // the gate folds to a static constant — a production release never ships the wallet-connect surface.
    __DEPLOY_ENV__: JSON.stringify(process.env.VERCEL_ENV || ''),
  },
  envDir: '../../',
  build: { sourcemap: false },
  // NO_HMR=1 freezes the running page: agents constantly edit the shared working tree, and every save
  // hot-reloading into a live dev session = half-written code on screen. With HMR off, file
  // changes apply only on a manual refresh. Agent dev servers on their own ports simply don't set the flag.
  server: { port: 5173, hmr: process.env.NO_HMR ? false : undefined },
})
