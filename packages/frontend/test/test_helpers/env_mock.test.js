// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1788 — bun fills missing mock exports from the real module, so factory completeness is the leak fence.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { ENV_MOCK } from '../../src/test_helpers/env_mock.js'

const env_source = readFileSync(new URL('../../src/env.ts', import.meta.url), 'utf8')
const env_keys = [...env_source.matchAll(/^export const ([A-Z][A-Z0-9_]*)\b/gm)].map((match) => match[1]).sort()

describe('#1788 · env mock is a complete immutable env.ts constant surface', () => {
  test('factory keys stay in exact parity with env.ts', () => {
    expect(Object.keys(ENV_MOCK).sort()).toEqual(env_keys)
  })

  test('the shared factory surface cannot be mutated between suites', () => {
    expect(Object.isFrozen(ENV_MOCK)).toBe(true)
  })
})
