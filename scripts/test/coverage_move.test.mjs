// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

const source = readFileSync(new URL('../coverage_move.sh', import.meta.url), 'utf8')
const library = source.slice(0, source.indexOf('\ncover_package packages/control'))

const run_coverage = (scenario) => {
  const root = mkdtempSync(join(tmpdir(), 'ares-move-coverage-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'packages/fixture'), { recursive: true })
    // A stale local trace must never make a clean-CI failure look green.
    if (scenario !== 'type_only') writeFileSync(join(root, 'packages/fixture/.coverage_map.mvcov'), 'stale')
    writeFileSync(join(root, 'scripts/coverage_move.sh'), `${library}\ncover_package packages/fixture 100\n`)
    writeFileSync(
      join(root, 'bin/sui'),
      `#!/bin/sh
set -eu
case "$2" in
  test)
    [ "$SCENARIO" != test_failure ] || exit 1
    exit 0
    ;;
  coverage)
    if [ -f packages/fixture/.coverage_map.mvcov ]; then
      printf 'Module fixture::legacy\n>>> No source code to compute coverage\n| %% Move Coverage: NaN |\n'
      exit 0
    fi
    echo 'Coverage map does not exist'
    exit 1
    ;;
  build)
    [ "$SCENARIO" != build_failure ] || exit 1
    mkdir -p packages/fixture/build/fixture/bytecode_modules
    [ "$SCENARIO" = no_modules ] || echo bytecode > packages/fixture/build/fixture/bytecode_modules/fixture.mv
    ;;
  summary)
    [ "$SCENARIO" != summary_failure ] || exit 1
    for last; do :; done
    mkdir -p "$last/0x0"
    case "$SCENARIO" in
      executable) echo '{"id":{"name":"fixture"},"functions":{"private_function":{}}}' > "$last/0x0/fixture.json" ;;
      malformed) echo '{"id":{"name":"fixture"}}' > "$last/0x0/fixture.json" ;;
      *) echo '{"id":{"name":"fixture"},"functions":{}}' > "$last/0x0/fixture.json" ;;
    esac
    echo '{"id":{"name":"dependency"},"functions":{"framework_function":{}}}' > "$last/0x0/dependency.json"
    ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 }
    )
    return execFileSync('sh', [join(root, 'scripts/coverage_move.sh')], {
      cwd: root,
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, SCENARIO: scenario },
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('type-only bytecode needs no execution trace to satisfy its full coverage floor', () => {
  expect(run_coverage('type_only')).toContain('Move coverage: packages/fixture 100% (floor 100%)')
})

test.each(['executable', 'malformed', 'no_modules', 'build_failure', 'summary_failure', 'test_failure'])(
  'missing coverage cannot hide %s, even when a stale trace exists',
  (scenario) => {
    expect(() => run_coverage(scenario)).toThrow()
  }
)
