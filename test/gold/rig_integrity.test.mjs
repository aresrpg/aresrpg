// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The gold rig's integrity gate as a plain bun unit (`ares test unit` — the sole testing gate): the localnet
// dependency closure AND the browser dynamic-import audit. RED-FIRST provenance (FIGHT_ENTRY_SEAM 2026-07-18):
// M1a moved src/fight/ into packages/fight and the driven-gate helpers kept importing '/src/fight/index.js' —
// the dev server 404'd it, `snapshot()`'s poll swallowed the rejection (`.catch(() => false)`), and five
// composite driven-gate attempts read as "the fight store never receives the fight" while the app pipeline was
// green the whole time (attempt-5 trace: GET /src/fight/index.js → 404). This gate makes the class un-shippable.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import * as lib_gold from './lib_gold.mjs'
import { repoint_kiosk_dependency } from './kiosk_manifest.mjs'
import { missing_rig_paths, stale_browser_imports } from './rig_integrity.mjs'

const social_manifest_path = fileURLToPath(new URL('../../packages/move/social/Move.toml', import.meta.url))

describe('gold rig integrity (node twin of specs/rig_integrity.spec.ts)', () => {
  test('the localnet dependency closure exists', () => {
    expect(missing_rig_paths()).toEqual([])
  })

  test('every browser dynamic-import literal resolves on THIS tree', () => {
    const stale = stale_browser_imports()
    expect(
      stale.map((row) => `${row.file}:${row.line} → import('${row.url}')`),
      'stale rig imports 404 on the dev server at drive time and the polling helpers swallow it — re-point them ' +
        '(moved workspace code is served under /@id/@aresrpg/<pkg>, the house precedent)'
    ).toEqual([])
  })
})

describe('gold Kiosk manifest repoint (#1577)', () => {
  test('the current pinned-SHA rev line is matched by key, not value', () => {
    const source = fs.readFileSync(social_manifest_path, 'utf8')
    const current_dependency =
      '[dependencies.Kiosk]\n' +
      'git = "https://github.com/MystenLabs/apps.git"\n' +
      'subdir = "kiosk"\n' +
      'rev = "a1cd20107340bf8f6e6913ed20b9fafe92fe3d03"\n'
    expect(source).toContain(current_dependency)

    const result = repoint_kiosk_dependency(source)
    expect(result).toEqual({
      ok: true,
      manifest: source.replace(current_dependency, '[dependencies.Kiosk]\nlocal = "../kiosk"\n'),
    })

    const repinned = source.replace(
      'rev = "a1cd20107340bf8f6e6913ed20b9fafe92fe3d03"',
      'rev = "ffffffffffffffffffffffffffffffffffffffff"'
    )
    expect(repoint_kiosk_dependency(repinned).ok).toBe(true)
  })
})

describe('gold compose worktree isolation', () => {
  test('derives stable worktree identity, disjoint port blocks, and honors the compose override', () => {
    const root_a = '/tmp/aresrpg-worktrees/alpha'
    const root_b = '/tmp/aresrpg-worktrees/beta'
    const first = lib_gold.derive_gold_isolation(root_a)
    const repeated = lib_gold.derive_gold_isolation(root_a)
    const second = lib_gold.derive_gold_isolation(root_b)

    expect(repeated).toEqual(first)
    expect(first.project_name).toBe('aresrpg-gold-a5a06a5d')
    expect(second.project_name).toBe('aresrpg-gold-73ebc16b')

    const first_ports = new Set(Object.values(first.ports))
    const second_ports = new Set(Object.values(second.ports))
    expect(first_ports.size).toBe(6)
    expect(second_ports.size).toBe(6)
    expect([...first_ports].filter((port) => second_ports.has(port))).toEqual([])
    expect(first.endpoints).toEqual({
      rpc: `http://127.0.0.1:${first.ports.rpc}`,
      faucet: `http://127.0.0.1:${first.ports.faucet}`,
      api: `http://127.0.0.1:${first.ports.api}`,
      sponsor: `http://127.0.0.1:${first.ports.sponsor}`,
    })
    expect(
      lib_gold.derive_gold_isolation(root_a, {
        COMPOSE_PROJECT_NAME: 'manual-gold-project',
        GOLD_PROJECT: 'legacy-gold-project',
      }).project_name
    ).toBe('manual-gold-project')
  })
})
