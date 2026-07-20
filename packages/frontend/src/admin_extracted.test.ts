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

const SRC = fileURLToPath(new URL('.', import.meta.url))
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('admin surface is extracted from the public client', () => {
  test('the app router no longer mounts the /admin route, its guard, or AdminPage', () => {
    const app = read('app.tsx')
    expect(app).not.toContain('path="/admin"')
    expect(app).not.toContain('AdminPage')
    expect(app).not.toContain('admin-gate')
    expect(app).not.toContain('GuardedRoute')
  })

  test('the nav exposes no admin tab', () => {
    expect(NAV_ITEMS.some((item) => item.id === 'admin' || item.path === '/admin')).toBe(false)
  })

  test('no admin source files remain in the client tree', () => {
    expect(existsSync(join(SRC, 'pages/admin.tsx'))).toBe(false)
    expect(existsSync(join(SRC, 'publish'))).toBe(false)
    expect(existsSync(join(SRC, 'game/core/admin-gate.js'))).toBe(false)
    expect(existsSync(join(SRC, 'game/screens/hud/AdminDrawer.jsx'))).toBe(false)
    expect(readdirSync(join(SRC, 'components')).filter((f) => f.startsWith('admin_'))).toEqual([])
  })

  test('no client module imports the extracted admin surface', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8')
          if (/from ['"][^'"]*(?:core\/admin-gate|pages\/admin|\/publish\/|components\/admin_)/.test(source))
            offenders.push(path.slice(SRC.length))
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
