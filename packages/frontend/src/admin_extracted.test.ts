// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { NAV_ITEMS } from './constants/navigation'

// ADMIN EXTRACTION (OSS source-available split, 2026-07-19): the admin surface moved OUT of this
// public-bound client into the private `apps/admin` app. The public client keeps NOTHING admin-capable
// — no /admin route, no admin nav tab, no owner-gate, no admin components / publish ceremony. This is
// IP/UX hygiene, not security: every admin mutation stays AdminCap-authorized on-chain regardless of
// what any client renders. This test is the ratchet — if any admin surface re-enters the open tree it
// goes red.
//
// #75 (2026-07-21): the route/nav was already gone, but its dev-only authoring seam survived as orphaned
// clients — local_items.js/seed_local.ts (dev-middleware clients for authoring endpoints that no longer
// exist), the image-generation queue chain (gemini.ts/image_queue.ts/image_generator_modal.tsx/
// image_queue_panel.tsx — reachable only from the deleted admin item editor), and the admin-only
// `/__publish_build` vite dev plugin. Extended here so the ratchet covers the whole authoring seam, not
// just the route.

const SRC = fileURLToPath(new URL('.', import.meta.url))
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('admin surface is extracted from the public client', () => {
  test('the app router no longer mounts the /admin route, its guard, or AdminPage', () => {
    const app = read('app.tsx')
    expect(app).not.toContain('path="/admin"')
    expect(app).not.toContain('AdminPage')
    expect(app).not.toContain('admin-gate')
    expect(app).not.toContain('GuardedRoute')
    expect(app).not.toContain('ImageQueuePanel')
  })

  test('the nav exposes no admin tab', () => {
    expect(NAV_ITEMS.some((item) => item.id === 'admin' || item.path === '/admin')).toBe(false)
  })

  test('no admin source files remain in the client tree', () => {
    expect(existsSync(join(SRC, 'pages/admin.tsx'))).toBe(false)
    expect(existsSync(join(SRC, 'publish'))).toBe(false)
    expect(existsSync(join(SRC, 'game/core/admin-gate.js'))).toBe(false)
    expect(existsSync(join(SRC, 'game/screens/hud/AdminDrawer.jsx'))).toBe(false)
    expect(existsSync(join(SRC, 'game/screens/hud/admin.css'))).toBe(false)
    expect(readdirSync(join(SRC, 'components')).filter((f) => f.startsWith('admin_'))).toEqual([])
  })

  test('#75: no dev-only authoring-client seam remains (local authoring, image-gen queue chain)', () => {
    expect(existsSync(join(SRC, 'lib/local_items.js'))).toBe(false)
    expect(existsSync(join(SRC, 'lib/seed_local.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'lib/seed_local.test.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'services/gemini.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'stores/image_queue.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'stores/image_queue.test.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'components/image_generator_modal.tsx'))).toBe(false)
    expect(existsSync(join(SRC, 'components/image_queue_panel.tsx'))).toBe(false)
  })

  test('#75: the vite config carries no admin-only /__publish_build dev plugin', () => {
    const vite_config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8')
    expect(vite_config).not.toContain('__publish_build')
    expect(vite_config).not.toContain('publish_dev_plugin')
  })

  test('no client module imports the extracted admin surface', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8')
          if (
            /from ['"][^'"]*(?:core\/admin-gate|pages\/admin|\/publish\/|components\/admin_|lib\/local_items|lib\/seed_local|services\/gemini|stores\/image_queue|components\/image_generator_modal|components\/image_queue_panel)/.test(
              source
            )
          )
            offenders.push(path.slice(SRC.length))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })

  test('#75: the admin/queue i18n namespaces are gone from every locale (orphaned admin-only strings)', () => {
    const LANGS = ['en', 'fr', 'de', 'es', 'ja', 'uk']
    for (const lang of LANGS) {
      const locale = JSON.parse(read(`i18n/locales/${lang}.json`))
      expect(Object.keys(locale)).not.toContain('admin')
      expect(Object.keys(locale)).not.toContain('queue')
    }
  })
})
