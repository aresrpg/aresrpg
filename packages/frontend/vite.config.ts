// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { parse } from 'yaml'

import { resolve_env, type PublicEnv } from './src/env.ts'
import { display_assets_plugin } from './display_assets.ts'
import { seed_dev_plugin } from './seed_dev_server.ts'
import { music_assets_plugin, sound_assets_plugin } from './sound_assets.ts'

const frontend_dir = dirname(fileURLToPath(import.meta.url))
const repo_dir = resolve(frontend_dir, '../..')

const escape_html = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const html_env_plugin = (env: PublicEnv): Plugin => {
  const values = {
    APP_NAME: env.app_name,
    APP_URL: env.app_url,
    META_DESCRIPTION: env.meta_description,
    META_TITLE: env.meta_title,
    SOCIAL_DESCRIPTION: env.social_description,
    SOCIAL_IMAGE_URL: env.social_image_url,
    THEME_COLOR: env.theme_color,
  }
  return {
    name: 'aresrpg-html-env',
    transformIndexHtml: (html) =>
      Object.entries(values).reduce(
        (rendered, [name, value]) => rendered.replaceAll(`{{${name}}}`, escape_html(value)),
        html
      ),
  }
}

const yaml_plugin = (): Plugin => ({
  name: 'aresrpg-yaml',
  transform: (source, id) =>
    id.endsWith('.yaml') ? { code: `export default ${JSON.stringify(parse(source))}` } : null,
})

export default defineConfig(({ mode }) => {
  // Env is PER-DEPLOYABLE (owner 2026-08-16): this package's own .env, never a repo-root file.
  const loaded_env = loadEnv(mode, '.', '')
  const env = resolve_env(loaded_env)
  return {
    plugins: [
      html_env_plugin(env),
      yaml_plugin(),
      ...sound_assets_plugin(resolve(repo_dir, 'seed/sounds')),
      ...music_assets_plugin(resolve(repo_dir, 'music')),
      ...display_assets_plugin({
        characters_dir: resolve(repo_dir, 'seed/icons/characters'),
        items_dir: resolve(repo_dir, 'seed/icons/items'),
      }),
      ...(mode === 'development'
        ? [seed_dev_plugin({ repo_dir, content_dir: resolve(repo_dir, 'seed/content') })]
        : []),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        manifest: {
          id: '/',
          name: env.app_name,
          short_name: env.app_name,
          description: env.meta_description,
          start_url: '/',
          scope: '/',
          lang: 'en',
          dir: 'ltr',
          display: 'standalone',
          orientation: 'landscape',
          categories: ['games', 'entertainment'],
          theme_color: env.theme_color,
          background_color: env.theme_color,
          icons: [
            { src: '/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          // Content art loads on demand and is never precached. Chain, auth, and world requests stay network-owned.
          // Manifest icons are added by VitePWA independently of this versioned app-file glob.
          globPatterns: ['**/*.{js,css,html,ico}'],
          globIgnores: ['logo-192.png', 'logo-512.png'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    // WebGPU lights and node materials rely on shared Three.js class identity.
    resolve: {
      dedupe: ['three', 'three/webgpu'],
    },
    // Workspace source must stay live during development. Prebundling freezes engine edits and
    // SDK subpath exports at server boot, which makes newly generated surfaces appear missing.
    optimizeDeps: { exclude: ['@aresrpg/engine', '@aresrpg/sdk'] },
    // Three.js is isolated in the lazy world chunk; 550 kB keeps the warning meaningful for accidental growth.
    build: { chunkSizeWarningLimit: 550 },
  }
})
