// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { resolve_app_version } from './resolve_app_version.mjs'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

// v1.12.37 PROD INCIDENT (github.com/aresrpg/aresrpg, maintainer-reported): the sidebar/cinematic
// version tag rendered `VE771893` — git's raw abbreviated commit SHA (e771893) with a `v` prefix,
// CSS-uppercased by the house label idiom — instead of the release semver `v1.12.37`.
//
// Root cause: vite.config.ts's old APP_VERSION IIFE ran `env_app_version || git describe --tags
// --always || pkg.version`, on the documented assumption that "a git-less build (Vercel remote)
// never breaks" (a try/catch around the git call). That assumption is false: Vercel's remote
// build DOES check out `.git` — it just doesn't fetch tags, so `--always` doesn't throw, it
// silently falls back to the raw abbreviated commit SHA. RED evidence (captured pre-fix, against
// a faithful extraction of that exact chain): `resolve_app_version({ env_app_version: undefined,
// pkg_version: '1.12.37', describe_tags: () => 'e771893' })` returned `'e771893'`, not `'1.12.37'`
// — see the PR description for the raw failing run. A SECOND failure shape was confirmed
// empirically in a full local clone (tags present, HEAD 39 commits past the last tag):
// `git describe --tags --always` returned `v1.12.37-39-g706c680` — still not a clean semver.
describe('resolve_app_version', () => {
  test('resolves to exactly the package.json version handed to it', () => {
    expect(resolve_app_version('1.12.37')).toBe('1.12.37')
    expect(`v${resolve_app_version('1.12.37')}`).toBe('v1.12.37')
    // Never confuse a version string with a commit-SHA-shaped or tag-describe-shaped one.
    expect(resolve_app_version('1.12.37')).not.toBe('e771893')
    expect(resolve_app_version('1.12.37')).not.toBe('v1.12.37-39-g706c680')
  })

  test('is a pure single-argument function — no env/git seam left to leak a SHA through', () => {
    expect(resolve_app_version.length).toBe(1)
  })

  // Guards the actual reported regression at the source: vite.config.ts must derive __APP_VERSION__
  // from resolve_app_version(pkg.version) alone, with no git-describe/env fallback chain resurrected
  // around it (that chain is exactly what shipped the raw SHA in v1.12.37 — see the incident note
  // above). Raw source-text read (not an import) because vite.config.ts is a Node/Vite build script,
  // not app source bun:test should execute.
  test('vite.config.ts wires __APP_VERSION__ through resolve_app_version(pkg.version) with no git-describe fallback nearby', () => {
    const vite_config = read_fixture('../vite.config.ts')
    expect(vite_config).toContain("import { resolve_app_version } from './src/resolve_app_version.mjs'")
    expect(vite_config).toContain('const APP_VERSION = resolve_app_version(pkg.version)')
    expect(vite_config).toContain('__APP_VERSION__: JSON.stringify(APP_VERSION)')
    // The dangerous fallback must not be reachable from the APP_VERSION assignment line at all —
    // 'describe'/'process.env' only survive elsewhere in this file (GIT_SHA, a support-only Sentry
    // release id that is never rendered to a player — out of scope for this fix).
    const app_version_line = vite_config.split('\n').find((l) => l.includes('const APP_VERSION ='))
    expect(app_version_line).not.toContain('describe')
    expect(app_version_line).not.toContain('process.env')
  })
})
