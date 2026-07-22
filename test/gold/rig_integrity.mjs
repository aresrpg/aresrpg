// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const gold = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(gold, '..', '..')

export const required_rig_paths = [
  'test/localnet/harness/Dockerfile',
  'test/localnet/bots/framework/context.js',
  'test/localnet/bots/framework/deps.js',
  'test/localnet/bots/framework/driver.js',
  'test/localnet/bots/framework/sdk.js',
  'test/localnet/bots/framework/sui.js',
  'test/localnet/bots/framework/world_flow.js',
]

export function missing_rig_paths() {
  return required_rig_paths.filter((relative_path) => !fs.existsSync(path.join(repo, relative_path)))
}

// ── BROWSER-IMPORT AUDIT (FIGHT_ENTRY_SEAM 2026-07-18) — the gold specs drive the app through browser-native
// dynamic imports (`page.evaluate` → dynamic-import literals of /src/… and /@id/… URLs). Those resolve against
// the LIVE vite dev server, so a repo refactor that moves a file (M1a moved src/fight/ → packages/fight) turns
// the import into a silent 404 the polling helpers swallow (`.catch(() => false)`) — five composite driven-gate
// attempts burned on exactly that before the class got this gate. Every literal is audited statically here:
//   • `/src/<p>`      must resolve under packages/frontend/src with vite's extension/index tries;
//   • `/@id/@aresrpg/<pkg>[/<sub>]` must name a workspace package (and a declared exports key for a sub-path);
//   • `/@id/<dep>`    must exist in node_modules (the frontend's own, or the hoisted root).

const import_literal_re = /import\(\s*'(\/src\/[^']+|\/@id\/[^']+)'\s*\)/g
const vite_tries = ['', '.js', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.tsx']

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out') continue
      yield* walk(full)
    } else if (/\.(ts|mjs)$/.test(entry.name)) yield full
  }
}

function src_url_resolves(url) {
  const base = path.join(repo, 'packages/frontend', url)
  return vite_tries.some((suffix) => fs.existsSync(base + suffix) && fs.statSync(base + suffix).isFile())
}

function id_url_resolves(url) {
  const spec = url.slice('/@id/'.length)
  if (spec.startsWith('@aresrpg/')) {
    const [, pkg, ...sub] = spec.split('/')
    const pkg_dir = path.join(repo, 'packages', pkg)
    if (!fs.existsSync(path.join(pkg_dir, 'package.json'))) return false
    if (!sub.length) return true
    const { exports = {} } = JSON.parse(fs.readFileSync(path.join(pkg_dir, 'package.json'), 'utf8'))
    return `./${sub.join('/')}` in exports
  }
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
  return (
    fs.existsSync(path.join(repo, 'packages/frontend/node_modules', name)) ||
    fs.existsSync(path.join(repo, 'node_modules', name))
  )
}

/** Every browser dynamic-import literal in the gold suite that no longer resolves on THIS tree. */
export function stale_browser_imports() {
  const stale = []
  for (const file of walk(gold)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(import_literal_re)) {
      const [, url] = match
      const resolves = url.startsWith('/src/') ? src_url_resolves(url) : id_url_resolves(url)
      if (!resolves)
        stale.push({ file: path.relative(repo, file), line: text.slice(0, match.index).split('\n').length, url })
    }
  }
  return stale
}

export function assert_rig_paths() {
  const missing = missing_rig_paths()
  if (missing.length) throw new Error(`gold rig references deleted localnet files: ${missing.join(', ')}`)
  const stale = stale_browser_imports()
  if (stale.length)
    throw new Error(
      `gold rig browser imports name moved/deleted modules (the dev server 404s them at drive time):\n` +
        stale.map((row) => `  ${row.file}:${row.line} → import('${row.url}')`).join('\n')
    )
}
