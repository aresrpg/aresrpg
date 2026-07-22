// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TREE-FREEZE (anchor suite) — MECHANICAL enforcement of "no lane writes during a suite run".
// Prose does not survive pressure, so the runner asserts tree stability ITSELF: globalSetup
// (tree_freeze_setup.ts) fingerprints the working tree, globalTeardown (tree_freeze_teardown.ts)
// recomputes and THROWS on drift — a thrown teardown fails the run loudly, which is the point.
//
// PURE CORE (unit-tested in tree_freeze_fingerprint.test.ts): porcelain text → suite-artifact
// filter → sha256. The filter exists because a RUNNING suite legitimately writes artifacts; every
// exclusion below names its writer. The suite-artifact exclusions are ALSO gitignored today
// (test/gold/.gitignore: out/, node_modules; root: node_modules/), so porcelain normally never
// lists them — there the filter is the drift-proof backstop. The ambient-writer exclusion
// (EXCLUDED_FILES) is TRACKED, so filter + diff pathspec are its only shield.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const GOLD = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(GOLD, '..', '..')
/** Setup snapshot home — under out/ (suite-owned, gitignored, itself excluded from the fingerprint). */
export const STATE_FILE = path.join(GOLD, 'out', '.tree-freeze-fingerprint')

// test/gold/out/ — playwright outputDir (out/pw-anchor traces/videos), spec artifacts
// (anchor_*.json, fight records via fight_record_helpers OUT_DIR), vite fixture emits
// (out/fixtures), and THIS module's own state file.
const EXCLUDED_PREFIXES = ['test/gold/out/']
// node_modules/ — the anchor config's two webServer vite instances write optimizer caches DURING
// the run (packages/frontend/node_modules/.vite + .vite-lagged). .playwright-artifacts — the
// runner's temp staging dirs (placement varies by version).
const EXCLUDED_SEGMENTS = ['node_modules/', '.playwright-artifacts']
// The session prompt-log file (excluded below) — the UserPromptSubmit appender hook writes it AMBIENTLY on every
// prompt event, suites included (fired the freeze on its first production run, 07-17: mid-run append
// to the already-dirty file — porcelain unchanged, the content hash caught it). Outside any lane's
// control and app-benign (vite imports nothing from docs/). It is TRACKED — not gitignored — so the
// exclusion must cover BOTH detectors: this list feeds the porcelain filter (clean→M transition case)
// AND the `git diff HEAD` pathspec in snapshot_tree (the append-on-dirty case that actually fired).
const EXCLUDED_FILES = ['docs/OWNER_PROMPTS.md']

const unquote = (p: string): string => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p)

const path_excluded = (p: string): boolean => {
  const clean = unquote(p)
  return (
    EXCLUDED_FILES.includes(clean) ||
    EXCLUDED_PREFIXES.some((prefix) => clean.startsWith(prefix) || clean === prefix.slice(0, -1)) ||
    EXCLUDED_SEGMENTS.some((segment) => clean.includes(segment))
  )
}

// One porcelain v1 line = `XY path` (rename: `XY orig -> dest`). A line is dropped only when EVERY
// path in it is suite-owned — a rename touching product source on either side is still drift, and
// any unparseable shape stays in (the freeze errs toward tripping, never toward silence).
const line_excluded = (line: string): boolean => line.slice(3).split(' -> ').every(path_excluded)

export const filter_porcelain = (porcelain: string): string =>
  porcelain
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => !line_excluded(line))
    .join('\n')

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export const fingerprint = (porcelain: string): { filtered: string; hash: string } => {
  const filtered = filter_porcelain(porcelain)
  return { filtered, hash: sha256(filtered) }
}

/** Porcelain is one line per path, so a set difference IS the meaningful unified diff. */
export const porcelain_diff = (before: string, after: string): string => {
  const before_lines = new Set(before.split('\n').filter((line) => line !== ''))
  const after_lines = new Set(after.split('\n').filter((line) => line !== ''))
  return [
    ...[...before_lines].filter((line) => !after_lines.has(line)).map((line) => `- ${line}`),
    ...[...after_lines].filter((line) => !before_lines.has(line)).map((line) => `+ ${line}`),
  ].join('\n')
}

// ── EFFECT EDGE (only setup/teardown call below here; the unit suite stays on the pure core) ─────
// Porcelain is path+status only — it CANNOT see a further edit to an already-modified tracked file
// (the dominant lane-write class on a dirty tree), so the snapshot ALSO hashes `git diff HEAD`
// (tracked content, staged included — staging mid-run trips it too, per the never-touch-the-index
// law). Accepted blind spot: content edits to files already UNTRACKED at setup (path-level only).
// --no-optional-locks keeps `git status` from refreshing the index stat cache (read-only probe).
const git = (...args: readonly string[]): string =>
  execFileSync('git', ['--no-optional-locks', '-C', REPO, ...args], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })

export const snapshot_tree = (): { porcelain: string; porcelain_hash: string; content_hash: string } => {
  const { filtered, hash } = fingerprint(git('status', '--porcelain=v1'))
  return {
    porcelain: filtered,
    porcelain_hash: hash,
    content_hash: sha256(
      git(
        'diff',
        '--no-color',
        '--no-ext-diff',
        'HEAD',
        '--',
        '.',
        ...EXCLUDED_FILES.map((file) => `:(exclude)${file}`)
      )
    ),
  }
}
