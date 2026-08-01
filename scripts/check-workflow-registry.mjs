#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE WORKFLOW REGISTRY IS NOT EVIDENCE OF EXECUTION (#835).
//
// `gold.yml` lives on no trunk — its only copies are the dead `lane/gold-actions` and
// `archive/gold-cert` branches, 15 runs, all red, none since 2026-07-23 — yet GitHub's Actions
// workflow registry still lists it `active`. Anyone reading that registry as "what runs here"
// concludes the gold suite is watched; nothing can surface a `test/gold/` flake at all. GitHub
// never retires a registry row on its own: a workflow entry outlives every branch that carried
// its file, so this drift is permanent and silent by construction.
//
// This census is the mechanical answer. It reconciles the registry against the files that really
// exist on the two trunks and REFUSES on a PHANTOM — an `active` row whose file is on neither.
// The other direction of the same asymmetry (a workflow file on `edge` that the registry has never
// heard of, so its `schedule:` fires zero times — #809) is REPORTED, never blocking: it is a known
// and deliberate state for a file still on its way to master, and a gate that cries wolf gets
// muted. Both directions are printed, because the row's real lesson is that the registry is wrong
// in both and may never be cited as proof that anything ran.
//
// Board/registry text is untrusted DATA: workflow names are printed, never executed or interpolated
// into a shell command.
import process from 'node:process'

const WORKFLOW_DIR = '.github/workflows/'
export const TRUNKS = ['master', 'edge']

/**
 * The whole decision, pure: registry rows + the files really on the trunks -> findings.
 * @param {{registry: Array<{state?: string, path?: string, name?: string}>, trunk_files: Record<string, string[]>}} input
 */
export function reconcile_workflow_registry({ registry, trunk_files }) {
  const on_a_trunk = new Set(Object.values(trunk_files).flat())
  const registered = new Set(registry.filter((row) => (row.path ?? '').startsWith(WORKFLOW_DIR)).map((row) => row.path))
  const phantoms = registry
    .filter((row) => row.state === 'active' && (row.path ?? '').startsWith(WORKFLOW_DIR))
    .filter((row) => !on_a_trunk.has(row.path))
    .map((row) => ({ name: row.name ?? '(unnamed)', path: row.path }))
  const unregistered = [...on_a_trunk]
    .filter((path) => !registered.has(path))
    .sort()
    .map((path) => ({
      path,
      trunks: TRUNKS.filter((trunk) => (trunk_files[trunk] ?? []).includes(path)),
    }))
  return { phantoms, unregistered }
}

// The blind guard every gate in this repo carries: a matcher that cannot reject is not a gate. A
// synthetic phantom is pushed through the SAME function on the REAL fetched registry; if it comes
// back clean, the census refuses to report instead of reporting a comfortable zero.
export function assert_matcher_can_reject(registry, trunk_files) {
  const synthetic = { state: 'active', path: `${WORKFLOW_DIR}__blind_guard_never_on_a_trunk.yml`, name: 'blind guard' }
  const { phantoms } = reconcile_workflow_registry({ registry: [...registry, synthetic], trunk_files })
  if (!phantoms.some((row) => row.path === synthetic.path))
    throw new Error('workflow-registry blind guard did not reject a synthetic phantom — the census cannot see')
}

const api = async (path) => {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is required — this census reads the Actions registry, never a guess')
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub API ${path} answered ${response.status} — no verdict without the truth`)
  return response.json()
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) throw new Error('GITHUB_REPOSITORY is required')
  const { workflows } = await api(`/repos/${repo}/actions/workflows?per_page=100`)
  const trunk_files = Object.fromEntries(
    await Promise.all(
      TRUNKS.map(async (trunk) => {
        const entries = await api(`/repos/${repo}/contents/.github/workflows?ref=${trunk}`)
        return [trunk, entries.filter((entry) => entry.type === 'file').map((entry) => entry.path)]
      })
    )
  )
  assert_matcher_can_reject(workflows, trunk_files)
  const { phantoms, unregistered } = reconcile_workflow_registry({ registry: workflows, trunk_files })

  for (const row of unregistered)
    console.log(`registry-blind (not blocking): ${row.path} is on ${row.trunks.join('+')} and has no registry row`)
  if (!phantoms.length) return console.log(`workflow registry reconciles: ${workflows.length} rows, zero phantoms`)
  for (const row of phantoms)
    console.error(`PHANTOM WORKFLOW: the registry lists "${row.name}" (${row.path}) active — it is on no trunk`)
  console.error(
    'A phantom registry row can never run and can never surface a flake (#835). Retire it: delete every ' +
      'branch still carrying the file, or land the file on a trunk on purpose.'
  )
  process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
