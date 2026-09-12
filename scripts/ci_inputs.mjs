// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import move_packages from '../move-packages.json' with { type: 'json' }

const BROWSER_PACKAGES = ['frontend', 'launchpad', 'engine', 'sdk', 'fight', 'immutable', 'protocol']
const BROWSER_FILES = [
  'bun.lock',
  'bunfig.toml',
  '.github/workflows/gate.yml',
  'scripts/ci_inputs.mjs',
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

const VERIFICATION_FILES = ['.github/workflows/gate.yml', 'scripts/ci_inputs.mjs', 'move-packages.json']
const MOVE_PATHS = move_packages.packages.map(({ path }) => `${path}/`)

export const ci_checks_required = (paths, manifest_changed) => {
  const shared = paths.some(
    (path) => VERIFICATION_FILES.includes(path) || (path === 'package.json' && manifest_changed(path))
  )
  const move =
    shared ||
    paths.some((path) => MOVE_PATHS.some((prefix) => path.startsWith(prefix)) || path === 'scripts/coverage_move.sh')
  return {
    browsers: shared || browser_checks_required(paths, manifest_changed),
    move,
    indexer:
      move ||
      paths.some(
        (path) =>
          ['packages/indexer/', 'packages/protocol/', '.cargo/'].some((prefix) => path.startsWith(prefix)) ||
          ['scripts/coverage_indexer.sh', 'rust-toolchain', 'rust-toolchain.toml'].includes(path)
      ),
  }
}

export const ci_checks_for_diff = (base, head, git) => {
  if (!base || /^0+$/.test(base)) return { browsers: true, move: true, indexer: true }
  const paths = git(['diff', '--name-only', '--no-renames', '-z', base, head]).split('\0').filter(Boolean)
  const exists = (ref, path) => git(['ls-tree', '--name-only', ref, '--', path]).trim() !== ''
  const manifest = (ref, path) => (exists(ref, path) ? runtime_manifest(git(['show', `${ref}:${path}`])) : null)
  return ci_checks_required(paths, (path) => manifest(base, path) !== manifest(head, path))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const checks = ci_checks_for_diff(process.env.BASE_SHA, 'HEAD', git)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(checks)
      .map(([lane, required]) => `${lane}=${required}\n`)
      .join('')
  )
  console.log('Verification inputs:', checks)
}
