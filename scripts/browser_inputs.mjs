// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BROWSER_PACKAGES = ['frontend', 'launchpad', 'engine', 'sdk', 'fight', 'immutable', 'protocol']
const BROWSER_FILES = [
  'bun.lock',
  'bunfig.toml',
  '.github/workflows/gate.yml',
  'scripts/browser_inputs.mjs',
  'scripts/browser_pins.ts',
]
const runtime_manifest = (source) => {
  if (source === null) return null
  const { version: _version, ...runtime } = JSON.parse(source)
  return JSON.stringify(runtime)
}

export const browser_checks_required = (paths, manifest_changed) =>
  paths.some((path) => {
    if (path === 'package.json' || BROWSER_PACKAGES.some((name) => path === `packages/${name}/package.json`))
      return manifest_changed(path)
    return (
      BROWSER_FILES.includes(path) ||
      BROWSER_PACKAGES.some((name) => path.startsWith(`packages/${name}/`)) ||
      ['seed/models/', 'seed/icons/', 'seed/structures/', 'music/'].some((prefix) => path.startsWith(prefix)) ||
      /^(?:vite|vercel)\.config\./.test(path)
    )
  })

export const browser_checks_for_diff = (base, head, git) => {
  if (!base || /^0+$/.test(base)) return true
  const paths = git(['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean)
  const exists = (ref, path) => git(['ls-tree', '--name-only', ref, '--', path]).trim() !== ''
  const manifest = (ref, path) => (exists(ref, path) ? runtime_manifest(git(['show', `${ref}:${path}`])) : null)
  return browser_checks_required(paths, (path) => manifest(base, path) !== manifest(head, path))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const required = browser_checks_for_diff(process.env.BASE_SHA, 'HEAD', git)
  appendFileSync(process.env.GITHUB_OUTPUT, `browsers=${required}\n`)
  console.log(
    required ? 'Browser runtime inputs changed: run browser checks' : 'No browser runtime changes: skip browser checks'
  )
}
