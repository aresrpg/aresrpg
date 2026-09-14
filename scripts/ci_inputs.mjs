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
  'scripts/prepare_browser.mjs',
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

const ALL_CHECKS = { browsers: true, move: true, indexer: true }
const MOVE_PATHS = move_packages.packages.map(({ path }) => `${path}/`)

// Workflow job boundaries are explicit in this repository. Unrecognized structure fails open to all checks.
const workflow_sections = (source) => {
  if (!source || /[&*][a-zA-Z_]/.test(source)) return null
  const boundary = source.indexOf('\njobs:\n')
  if (boundary < 0) return null
  const body = source.slice(boundary + 7)
  if (/^[^\s#]/m.test(body)) return null
  const sections = body.split(/(?=^ {2}[\w-]+:\s*$)/m)
  const jobs = Object.fromEntries(sections.map((section) => [section.match(/^ {2}([\w-]+):/)?.[1], section]))
  if (['changes', 'tests_move', 'tests_indexer', 'browsers'].some((job) => !jobs[job])) return null
  return { header: source.slice(0, boundary), ...jobs }
}

const workflow_checks = (before, after) => {
  const previous = workflow_sections(before)
  const current = workflow_sections(after)
  if (!previous || !current || previous.header !== current.header || previous.changes !== current.changes)
    return ALL_CHECKS
  return {
    browsers: previous.browsers !== current.browsers,
    move: previous.tests_move !== current.tests_move,
    indexer: previous.tests_indexer !== current.tests_indexer,
  }
}

export const ci_checks_required = (paths, manifest_changed, workflow = ALL_CHECKS) => {
  const changed_workflow = paths.includes('.github/workflows/gate.yml') ? workflow : {}
  const move =
    changed_workflow.move ||
    paths.some(
      (path) =>
        MOVE_PATHS.some((prefix) => path.startsWith(prefix)) ||
        ['scripts/coverage_move.sh', 'move-packages.json'].includes(path)
    )
  return {
    browsers:
      changed_workflow.browsers ||
      browser_checks_required(
        paths.filter((path) => path !== '.github/workflows/gate.yml'),
        manifest_changed
      ),
    move,
    indexer:
      move ||
      changed_workflow.indexer ||
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
  const workflow_path = '.github/workflows/gate.yml'
  const source = (ref) => (exists(ref, workflow_path) ? git(['show', `${ref}:${workflow_path}`]) : null)
  const workflow = paths.includes(workflow_path) ? workflow_checks(source(base), source(head)) : ALL_CHECKS
  return ci_checks_required(paths, (path) => manifest(base, path) !== manifest(head, path), workflow)
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
