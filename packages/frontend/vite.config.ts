// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'
import { parse } from 'yaml'

import { browser_pins_plugin } from '../../scripts/browser_pins.ts'

import { LoadingPostcard, type LoadingCopy } from './src/components/LoadingPostcard.tsx'
import { asset_inline_limit } from './asset_inline.ts'
import { locale_manifest_plugin } from './locale_assets.ts'
import { resolve_env, type PublicEnv } from './src/env.ts'
import { require_reporting_dsn } from './src/reporting_config.ts'
import { display_assets_plugin } from './display_assets.ts'
import { escape_html, social_cards_plugin } from './social_cards.ts'
import { seed_dev_plugin } from './seed_dev_server.ts'
import { music_assets_plugin, sound_assets_plugin } from './sound_assets.ts'
import { solana_rpc_plugin } from './solana_rpc_dev.ts'
import { gift_dev_plugin } from './gift_dev.ts'
import { public_pages_plugin } from './public_pages.ts'

const frontend_dir = dirname(fileURLToPath(import.meta.url))
const repo_dir = resolve(frontend_dir, '../..')

const html_env_plugin = (env: PublicEnv, development: boolean): Plugin => {
  const copy = parse(readFileSync(resolve(frontend_dir, 'src/i18n/locales/en.yaml'), 'utf8')) as LoadingCopy
  const asset_root = development ? `/@fs/${repo_dir}/seed/icons/loading` : '../../seed/icons/loading'
  const loading = renderToStaticMarkup(
    createElement(LoadingPostcard, {
      copy,
      context: 'home',
      image: `${asset_root}/harbor.webp`,
      wordmark: `${asset_root}/wordmark.webp`,
      progress: { stage: 'assets', fraction: null },
      phase: 0,
      fraction: null,
      boot: true,
    })
  )
  const loading_css = readFileSync(resolve(frontend_dir, 'src/components/world_loading.css'), 'utf8')
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
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        Object.entries(values).reduce(
          (rendered, [name, value]) => rendered.replaceAll(`{{${name}}}`, escape_html(value)),
          html.replace('{{LOADING_SCREEN}}', loading).replace('{{LOADING_STYLES}}', loading_css)
        ),
    },
  }
}

const yaml_plugin = (): Plugin => ({
  name: 'aresrpg-yaml',
  transform: (source, id) =>
    id.endsWith('.yaml') ? { code: `export default ${JSON.stringify(parse(source))}` } : null,
})

export default defineConfig(({ mode, command }) => {
  // Env is PER-DEPLOYABLE (owner 2026-08-16): this package's own .env, never a repo-root file.
  const loaded_env = loadEnv(mode, frontend_dir, '')
  if (mode === 'production') require_reporting_dsn(loaded_env)
  const env = resolve_env(loaded_env)
  const manifest: Partial<ManifestOptions> = {
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
    screenshots: [{ src: '/social/home.jpg', sizes: '1200x630', type: 'image/jpeg', form_factor: 'wide' }],
  }
  return {
    // Local clients opt in through VITE_SERVER_WS_URL; production still verifies every login.
    server: {
      proxy: {
        '/api/allocation': { target: loaded_env.ALLOCATION_API_ORIGIN ?? 'http://localhost:9800', changeOrigin: true },
        '/__game_server': {
          target: 'wss://server.aresrpg.world',
          ws: true,
          changeOrigin: true,
          headers: { Origin: 'https://aresrpg.world' },
          rewrite: (path) => path.replace(/^\/__game_server/, ''),
        },
      },
    },
    define: {
      'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(loaded_env.VERCEL_ENV ?? 'local'),
      'import.meta.env.VITE_RELEASE': JSON.stringify(loaded_env.VERCEL_GIT_COMMIT_SHA || loaded_env.GITHUB_SHA || ''),
    },
    plugins: [
      public_pages_plugin(),
      gift_dev_plugin(loaded_env),
      solana_rpc_plugin(loaded_env.SOLANA_RPC_URL),
      browser_pins_plugin(loaded_env.ARES_PINS_FILE, env.network),
      html_env_plugin(env, command === 'serve'),
      yaml_plugin(),
      locale_manifest_plugin(manifest),
      ...sound_assets_plugin(resolve(repo_dir, 'seed/sounds')),
      ...music_assets_plugin(resolve(repo_dir, 'music')),
      ...display_assets_plugin({
        characters_dir: resolve(repo_dir, 'seed/icons/characters'),
        items_dir: resolve(repo_dir, 'seed/icons/items'),
      }),
      social_cards_plugin(
        {
          cards_dir: resolve(repo_dir, 'seed/icons/social'),
          content_dir: resolve(repo_dir, 'seed/content'),
          copy_path: resolve(frontend_dir, 'src/i18n/locales/en.yaml'),
          icons_dir: resolve(repo_dir, 'seed/icons'),
        },
        {
          app_url: env.app_url,
          font_path: resolve(repo_dir, 'packages/journal/public/assets/jetbrains-mono.woff2'),
          logo_path: resolve(repo_dir, 'seed/scenes/aresrpg_text_logo.png'),
          tokens_path: resolve(frontend_dir, 'src/tailwind.css'),
        }
      ),
      ...(mode === 'development'
        ? [seed_dev_plugin({ repo_dir, content_dir: resolve(repo_dir, 'seed/content') })]
        : []),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        manifest,
        workbox: {
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          // Content art loads on demand and is never precached. Chain, auth, and world requests stay network-owned.
          // Manifest icons are added by VitePWA independently of this versioned app-file glob.
          globPatterns: ['**/*.{js,css,ico,webmanifest}'],
          globIgnores: ['logo-192.png', 'logo-512.png'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // Reload must fetch the current shell: an old shell can reference retired lazy art URLs.
          navigateFallback: null,
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
    build: {
      // Fetched models and city artifacts stay files: production connect-src excludes data URLs.
      assetsInlineLimit: asset_inline_limit,
      chunkSizeWarningLimit: 550,
      ...(mode === 'test'
        ? {
            rollupOptions: {
              input: {
                app: resolve(frontend_dir, 'index.html'),
                ...Object.fromEntries(
                  readdirSync(resolve(frontend_dir, 'e2e/fixtures'))
                    .filter((file) => file.endsWith('.html'))
                    .sort()
                    .map((file) => [file.slice(0, -5), resolve(frontend_dir, 'e2e/fixtures', file)])
                ),
              },
            },
          }
        : {}),
    },
  }
})
