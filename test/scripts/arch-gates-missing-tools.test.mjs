// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  chmodSync as chmod_sync,
  copyFileSync as copy_file_sync,
  existsSync as exists_sync,
  mkdirSync as mkdir_sync,
  mkdtempSync as make_temp_dir_sync,
  readFileSync as read_file_sync,
  readdirSync as read_dir_sync,
  rmSync as remove_sync,
  writeFileSync as write_file_sync,
} from 'node:fs'
import { tmpdir as temp_dir } from 'node:os'
import path from 'node:path'
import { spawnSync as spawn_sync } from 'node:child_process'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { afterEach, describe, expect, test } from 'bun:test'

const test_dir = path.dirname(file_url_to_path(import.meta.url))
const repo_root = path.resolve(test_dir, '../..')
const sandbox_roots = []

afterEach(() => {
  for (const root of sandbox_roots.splice(0)) {
    remove_sync(root, { force: true, recursive: true })
  }
})

function write_executable_script(root, relative_path, script) {
  const destination = path.join(root, relative_path)
  mkdir_sync(path.dirname(destination), { recursive: true })
  write_file_sync(destination, `#!/bin/sh\n${script}\n`)
  chmod_sync(destination, 0o755)
  return destination
}

function write_executable(root, relative_path, exit_code) {
  return write_executable_script(root, relative_path, `exit ${exit_code}`)
}

function run_gate(script_name, { args = [], env = {}, path_entries = [], setup = () => {} } = {}) {
  const root = make_temp_dir_sync(path.join(temp_dir(), 'ares-arch-gate-'))
  const script_dir = path.join(root, 'scripts')
  const script_path = path.join(script_dir, script_name)
  sandbox_roots.push(root)
  mkdir_sync(script_dir, { recursive: true })
  copy_file_sync(path.join(repo_root, 'scripts', script_name), script_path)
  chmod_sync(script_path, 0o755)
  setup(root)

  const env_overrides = typeof env === 'function' ? env(root) : env
  const executable_path = [...path_entries.map((entry) => path.join(root, entry)), '/usr/bin', '/bin'].join(':')
  const result = spawn_sync('/bin/bash', [script_path, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      HOME: path.join(root, 'home'),
      LANG: process.env.LANG ?? 'C',
      PATH: executable_path,
      ...env_overrides,
    },
  })
  return {
    output: `${result.stdout}${result.stderr}`,
    root,
    status: result.status,
  }
}

function baseline_temp_paths(root) {
  return read_dir_sync(root).filter((entry) => entry.startsWith('.dependency-cruiser-known-violations.json.tmp.'))
}

describe('architecture gates fail closed when a tool is absent', () => {
  test('semgrep absence cannot be bypassed by the retired environment controls', () => {
    const result = run_gate('semgrep-gate.sh', {
      env: (root) => ({
        ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
        SEMGREP_BIN: write_executable(root, 'retired/fake-semgrep', 0),
      }),
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: semgrep not installed')
    expect(result.output).not.toContain('SKIP')
  })

  test('semgrep is discovered through the isolated PATH', () => {
    const result = run_gate('semgrep-gate.sh', {
      path_entries: ['bin'],
      setup: (root) => {
        write_executable(root, 'bin/semgrep', 2)
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('semgrep failed (exit 2)')
    expect(result.output).not.toContain('semgrep not installed')
  })

  test('dependency-cruiser absence cannot be bypassed by the retired environment controls', () => {
    const result = run_gate('depcruise-gate.sh', {
      env: (root) => ({
        ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
        DEPCRUISE_BIN: write_executable(root, 'retired/fake-depcruise', 0),
      }),
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: dependency-cruiser not installed')
    expect(result.output).not.toContain('SKIP')
  })

  test('bun absence cannot be bypassed by the retired binary override', () => {
    const result = run_gate('depcruise-gate.sh', {
      env: (root) => ({
        ARESRPG_ALLOW_MISSING_ARCH_TOOLS: '1',
        BUN_BIN: write_executable(root, 'retired/fake-bun', 0),
      }),
      setup: (root) => {
        write_executable(root, 'node_modules/.bin/depcruise', 0)
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: bun not available')
    expect(result.output).not.toContain('SKIP')
  })
})

describe('dependency-cruiser baseline generation reports subprocess failures', () => {
  test('a successful write replaces the baseline only after formatting', () => {
    const original_baseline = '{"original":true}\n'
    const next_baseline = '{"next":true}\n'
    const result = run_gate('depcruise-gate.sh', {
      args: ['--write-baseline'],
      path_entries: ['bin'],
      setup: (root) => {
        write_executable_script(
          root,
          'bin/bun',
          [
            'while [ "$#" -gt 0 ]; do',
            '  if [ "$1" = "--output-to" ]; then',
            '    shift',
            `    printf '%s' '${next_baseline.trim()}' >"$1"`,
            '    exit 0',
            '  fi',
            '  shift',
            'done',
            'exit 3',
          ].join('\n')
        )
        write_executable(root, 'node_modules/.bin/depcruise', 0)
        write_executable(root, 'node_modules/.bin/prettier', 0)
        write_file_sync(path.join(root, '.dependency-cruiser-known-violations.json'), original_baseline)
      },
    })

    expect(result.status).toBe(0)
    expect(result.output).toContain('baseline written: .dependency-cruiser-known-violations.json')
    expect(read_file_sync(path.join(result.root, '.dependency-cruiser-known-violations.json'), 'utf8')).toBe(
      next_baseline.trim()
    )
    expect(baseline_temp_paths(result.root)).toEqual([])
  })

  test('a dependency-cruiser failure prevents a success verdict', () => {
    const result = run_gate('depcruise-gate.sh', {
      args: ['--write-baseline'],
      path_entries: ['bin'],
      setup: (root) => {
        write_executable(root, 'bin/bun', 17)
        write_executable(root, 'node_modules/.bin/depcruise', 0)
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: dependency-cruiser could not generate the baseline')
    expect(result.output).not.toContain('baseline written')
    expect(exists_sync(path.join(result.root, '.dependency-cruiser-known-violations.json'))).toBeFalse()
    expect(baseline_temp_paths(result.root)).toEqual([])
  })

  test('a missing Prettier prevents a success verdict', () => {
    const result = run_gate('depcruise-gate.sh', {
      args: ['--write-baseline'],
      path_entries: ['bin'],
      setup: (root) => {
        write_executable(root, 'bin/bun', 0)
        write_executable(root, 'node_modules/.bin/depcruise', 0)
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: prettier not installed')
    expect(result.output).not.toContain('baseline written')
  })

  test('a Prettier failure prevents a success verdict', () => {
    const original_baseline = '{"original":true}\n'
    const result = run_gate('depcruise-gate.sh', {
      args: ['--write-baseline'],
      path_entries: ['bin'],
      setup: (root) => {
        write_executable(root, 'bin/bun', 0)
        write_executable(root, 'node_modules/.bin/depcruise', 0)
        write_executable(root, 'node_modules/.bin/prettier', 19)
        write_file_sync(path.join(root, '.dependency-cruiser-known-violations.json'), original_baseline)
      },
    })

    expect(result.status).toBe(1)
    expect(result.output).toContain('FAIL: prettier could not format the baseline')
    expect(result.output).not.toContain('baseline written')
    expect(read_file_sync(path.join(result.root, '.dependency-cruiser-known-violations.json'), 'utf8')).toBe(
      original_baseline
    )
    expect(baseline_temp_paths(result.root)).toEqual([])
  })
})
