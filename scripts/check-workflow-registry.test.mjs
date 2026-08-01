// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The workflow-registry census driven through every polarity against CAPTURED registry bytes (#835).
//
// PROVENANCE — the rows below are the verbatim reply of
//   gh api repos/aresrpg/aresrpg/actions/workflows   (captured 2026-08-02)
// trimmed to the fields the census reads. `gold` is the real phantom the row indicts: registry state
// `active`, file on neither trunk (its only copies are lane/gold-actions and archive/gold-cert).
// `loop-deadman.yml` is the real opposite asymmetry: a file on edge with no registry row at all.
import { describe, expect, test } from 'bun:test'

import { assert_matcher_can_reject, reconcile_workflow_registry } from './check-workflow-registry.mjs'

const captured_registry = [
  { id: 321545551, state: 'active', name: 'board hygiene', path: '.github/workflows/board-hygiene.yml' },
  { id: 317000659, state: 'active', name: 'checks', path: '.github/workflows/checks.yml' },
  { id: 322816299, state: 'active', name: 'edge smoke', path: '.github/workflows/edge-smoke.yml' },
  { id: 323616149, state: 'active', name: 'fight bots', path: '.github/workflows/fight-bots.yml' },
  { id: 316916053, state: 'active', name: 'gate', path: '.github/workflows/gate.yml' },
  { id: 322616926, state: 'active', name: 'gold smoke', path: '.github/workflows/gold-smoke.yml' },
  { id: 318549572, state: 'active', name: 'gold', path: '.github/workflows/gold.yml' },
  { id: 322816298, state: 'active', name: 'nuclear audit', path: '.github/workflows/nuclear-audit.yml' },
  { id: 317363959, state: 'active', name: 'promote-queue', path: '.github/workflows/promote-queue.yml' },
  { id: 316992350, state: 'active', name: 'promote', path: '.github/workflows/promote.yml' },
  { id: 316916054, state: 'active', name: 'release', path: '.github/workflows/release.yml' },
  { id: 318355414, state: 'active', name: 'sentry triage', path: '.github/workflows/sentry-triage.yml' },
  // The registry's own dynamic row: not under .github/workflows/ and never a phantom.
  { id: 316948163, state: 'active', name: 'Dependabot Updates', path: 'dynamic/dependabot/dependabot-updates' },
]

// git ls-tree --name-only origin/{master,edge} .github/workflows/ — same capture.
const captured_trunk_files = {
  master: [
    '.github/workflows/board-hygiene.yml',
    '.github/workflows/checks.yml',
    '.github/workflows/edge-smoke.yml',
    '.github/workflows/fight-bots.yml',
    '.github/workflows/gate.yml',
    '.github/workflows/gold-smoke.yml',
    '.github/workflows/nuclear-audit.yml',
    '.github/workflows/promote-queue.yml',
    '.github/workflows/promote.yml',
    '.github/workflows/release.yml',
    '.github/workflows/sentry-triage.yml',
  ],
  edge: [
    '.github/workflows/board-hygiene.yml',
    '.github/workflows/checks.yml',
    '.github/workflows/edge-smoke.yml',
    '.github/workflows/fight-bots.yml',
    '.github/workflows/gate.yml',
    '.github/workflows/gold-smoke.yml',
    '.github/workflows/loop-deadman.yml',
    '.github/workflows/nuclear-audit.yml',
    '.github/workflows/promote-queue.yml',
    '.github/workflows/promote.yml',
    '.github/workflows/release.yml',
    '.github/workflows/sentry-triage.yml',
  ],
}

describe('workflow registry census · the captured truth', () => {
  test('gold.yml is caught: active in the registry, on neither trunk', () => {
    const { phantoms } = reconcile_workflow_registry({
      registry: captured_registry,
      trunk_files: captured_trunk_files,
    })
    expect(phantoms).toEqual([{ name: 'gold', path: '.github/workflows/gold.yml' }])
  })

  test('the opposite asymmetry is reported, never blocking', () => {
    const { unregistered } = reconcile_workflow_registry({
      registry: captured_registry,
      trunk_files: captured_trunk_files,
    })
    expect(unregistered).toEqual([{ path: '.github/workflows/loop-deadman.yml', trunks: ['edge'] }])
  })

  test('a workflow present on either trunk alone is never a phantom', () => {
    const edge_only = { ...captured_trunk_files, master: [] }
    const { phantoms } = reconcile_workflow_registry({ registry: captured_registry, trunk_files: edge_only })
    expect(phantoms.map((row) => row.path)).toEqual(['.github/workflows/gold.yml'])
  })

  test('a registry row outside .github/workflows/ is never judged', () => {
    const { phantoms, unregistered } = reconcile_workflow_registry({
      registry: [captured_registry.at(-1)],
      trunk_files: { master: [], edge: [] },
    })
    expect(phantoms).toEqual([])
    expect(unregistered).toEqual([])
  })

  test('a DISABLED registry row is not a phantom — retirement is exactly the fix', () => {
    const retired = captured_registry.map((row) => (row.name === 'gold' ? { ...row, state: 'disabled_manually' } : row))
    expect(reconcile_workflow_registry({ registry: retired, trunk_files: captured_trunk_files }).phantoms).toEqual([])
  })

  test('the clean state — every active row on a trunk — reports zero phantoms', () => {
    const clean = captured_registry.filter((row) => row.name !== 'gold')
    expect(reconcile_workflow_registry({ registry: clean, trunk_files: captured_trunk_files }).phantoms).toEqual([])
  })
})

describe('workflow registry census · the blind guard', () => {
  test('a synthetic phantom must be rejected by the same matcher', () => {
    expect(() => assert_matcher_can_reject(captured_registry, captured_trunk_files)).not.toThrow()
  })

  test('a census that cannot see refuses rather than reporting a comfortable zero', () => {
    // A trunk listing that swallows the synthetic row is a blinded census — it must refuse, not report 0.
    const swallowing_trunks = { master: [], edge: ['.github/workflows/__blind_guard_never_on_a_trunk.yml'] }
    expect(() => assert_matcher_can_reject(captured_registry, swallowing_trunks)).toThrow(/blind guard did not reject/)
  })
})
