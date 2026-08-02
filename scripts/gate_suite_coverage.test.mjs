// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2020 — THE GATE-ORPHAN CLASS GATE. `bun run test` is `bun run --filter '*' test`, which walks the
// bun workspace only, so a root-level `scripts/*.test.mjs` is reachable from NO gate until a workflow
// names it by path. Twice now that has been discovered by hand: #2013 found board_hygiene +
// sentry_triage running nowhere, and the same census immediately found four more (check-fixture-
// adjudication, check-loc-ledger-workflow, check-move-field-limits, loop_deadman — 39 assertions of
// coverage that had never executed). A list you have to remember to append to is not a gate.
//
// This is the meta-test that makes the class unrepresentable: every `scripts/*.test.mjs` in the tree
// must appear in some workflow's INVOCATION text, or carry an explicit justification below. A suite
// dropped into scripts/ now reds HERE until someone decides, in writing, whether CI runs it.
//
// WHY NOT GLOB-DISCOVERY (the row's own ruling): a gate step that globs `scripts/*.test.mjs` would
// silently execute anything dropped into scripts/ — that WIDENS CI's trust surface instead of
// narrowing it. Explicit-list-with-justification keeps the decision human and reviewable; this test
// only makes forgetting impossible.
//
// COMMENTS ARE NOT INVOCATIONS. The census reads `run:` command text with full-line comments
// stripped — a suite named only in a YAML or shell comment is exactly the lying-green this row
// exists to kill, and the fresh control below proves the stripper actually strips.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { describe, expect, it } from 'bun:test'

const script_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(script_dir, '..')
const workflow_dir = path.join(repo_root, '.github/workflows')

// A suite may be excluded only WITH A REASON, and the reason is reviewed like any other gate edit.
// Empty on purpose: every root suite in the tree is wired. `'<file>': 'why CI must not run it'`.
const JUSTIFIED_EXCLUSIONS = {}

/** Full-line comments are not commands — dropping them can only ever cost a false RED, never a false green. */
const command_text = (yaml) =>
  yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

const invocation_text = () => {
  const workflows = fs
    .readdirSync(workflow_dir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => fs.readFileSync(path.join(workflow_dir, file), 'utf8'))
  if (workflows.length === 0) throw new Error(`no workflows found under ${workflow_dir} — the census read nothing`)
  const package_json = fs.readFileSync(path.join(repo_root, 'package.json'), 'utf8')
  return [...workflows.map(command_text), package_json].join('\n')
}

/** `scripts/foo.test.mjs` must be THAT path, not the tail of `packages/move/scripts/foo.test.mjs`. */
const is_invoked = (text, suite) =>
  new RegExp(String.raw`(^|\s)scripts/${suite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\s|$)`, 'm').test(text)

const root_suites = () => {
  const suites = fs.readdirSync(script_dir).filter((file) => file.endsWith('.test.mjs'))
  if (suites.length === 0) throw new Error(`no scripts/*.test.mjs found in ${script_dir} — the census read nothing`)
  return suites.sort()
}

describe('#2020 — every root suite is invoked by some gate, or justified in writing', () => {
  it('the census reads a real population (positive control — an empty scan is a throw, never a pass)', () => {
    expect(root_suites().length).toBeGreaterThanOrEqual(5)
    expect(invocation_text().length).toBeGreaterThan(1000)
  })

  it('the matcher can find a wired suite and can miss an unwired one (blind guard)', () => {
    const text = invocation_text()
    expect(is_invoked(text, 'check-workflow-registry.test.mjs')).toBe(true)
    expect(is_invoked(text, 'a_suite_that_was_never_written.test.mjs')).toBe(false)
  })

  it('a same-named suite under another package does NOT satisfy a root suite (fresh control)', () => {
    const elsewhere = 'run: bun test packages/move/scripts/loop_deadman.test.mjs'
    expect(elsewhere).toContain('scripts/loop_deadman.test.mjs')
    expect(is_invoked(elsewhere, 'loop_deadman.test.mjs')).toBe(false)
    expect(is_invoked('run: bun test scripts/loop_deadman.test.mjs', 'loop_deadman.test.mjs')).toBe(true)
  })

  it('a suite named only in a comment does NOT count as invoked (fresh control)', () => {
    const commented = ['jobs:', '  # run: bun test scripts/only_mentioned_in_a_comment.test.mjs', '  steps: []'].join(
      '\n'
    )
    expect(commented).toContain('scripts/only_mentioned_in_a_comment.test.mjs')
    expect(command_text(commented)).not.toContain('scripts/only_mentioned_in_a_comment.test.mjs')
  })

  it('no root suite is gate-orphaned', () => {
    const text = invocation_text()
    const orphans = root_suites().filter(
      (suite) => !is_invoked(text, suite) && !Object.hasOwn(JUSTIFIED_EXCLUSIONS, suite)
    )
    if (orphans.length > 0)
      console.error(
        `GATE-ORPHANED root suite(s) — no workflow run: line names them (#2020):\n${orphans
          .map((suite) => `  scripts/${suite}`)
          .join('\n')}\nWire each into checks.yml's explicit list, or justify it in JUSTIFIED_EXCLUSIONS.`
      )
    expect(orphans).toEqual([])
  })

  it('every justified exclusion carries a reason and names a file that exists', () => {
    const suites = root_suites()
    for (const [suite, reason] of Object.entries(JUSTIFIED_EXCLUSIONS)) {
      expect(suites).toContain(suite)
      expect(`${reason}`.length).toBeGreaterThan(20)
    }
  })
})
