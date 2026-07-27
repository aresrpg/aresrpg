// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import path from 'node:path'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { describe, expect, test } from 'bun:test'

const test_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(test_dir, '../..')
const missing_binary = path.join(repo_root, 'test/scripts/fixtures/definitely-missing')
const depcruise_binary = path.join(repo_root, 'node_modules/.bin/depcruise')

function run_gate(script_name, env) {
  const result = spawn_sync('/bin/bash', [path.join(repo_root, 'scripts', script_name)], {
    cwd: repo_root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '',
      ...env,
    },
  })
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  }
}

describe('architecture gates fail closed when a tool is absent', () => {
  test('semgrep absence is a loud failure by default', () => {
    const result = run_gate('semgrep-gate.sh', {
      SEMGREP_BIN: missing_binary,
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: semgrep not installed')
    expect(result.output).toContain('ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1')
  })

  test('semgrep absence skips only through the explicit opt-out', () => {
    const result = run_gate('semgrep-gate.sh', {
      ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
      SEMGREP_BIN: missing_binary,
    })
    expect(result.status).toBe(0)
    expect(result.output).toContain('SKIP: semgrep not installed')
    expect(result.output).toContain('ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1')
  })

  test('dependency-cruiser absence is a loud failure by default', () => {
    const result = run_gate('depcruise-gate.sh', {
      DEPCRUISE_BIN: missing_binary,
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: dependency-cruiser not installed')
    expect(result.output).toContain('ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1')
  })

  test('dependency-cruiser absence skips only through the explicit opt-out', () => {
    const result = run_gate('depcruise-gate.sh', {
      ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
      DEPCRUISE_BIN: missing_binary,
    })
    expect(result.status).toBe(0)
    expect(result.output).toContain('SKIP: dependency-cruiser not installed')
    expect(result.output).toContain('ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1')
  })

  test('dependency-cruiser also fails when its required bun binary is absent', () => {
    const result = run_gate('depcruise-gate.sh', {
      BUN_BIN: missing_binary,
      DEPCRUISE_BIN: depcruise_binary,
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: bun not available')
  })

  test('the explicit opt-out also covers a missing bun runtime', () => {
    const result = run_gate('depcruise-gate.sh', {
      ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
      BUN_BIN: missing_binary,
      DEPCRUISE_BIN: depcruise_binary,
    })
    expect(result.status).toBe(0)
    expect(result.output).toContain('SKIP: bun not available')
    expect(result.output).toContain('ARESRPG_ALLOW_MISSING_ARCH_TOOLS=1')
  })

  test('the opt-out requires the exact documented value', () => {
    const result = run_gate('semgrep-gate.sh', {
      ARESRPG_ALLOW_MISSING_ARCH_TOOLS: 'true',
      SEMGREP_BIN: missing_binary,
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: semgrep not installed')
  })
})
