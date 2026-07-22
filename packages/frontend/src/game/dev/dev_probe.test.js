// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./dev_probe.js', import.meta.url), 'utf8')
const dev_move = source.slice(source.indexOf('async function dev_move'), source.indexOf('\nfunction dev_state'))

describe('__ARES_DEV_MOVE refusal reporting', () => {
  test('a refused commit returns ok:false with the captured store reason before the success result', () => {
    expect(dev_move).toContain('committed = await store.commit_turn')
    expect(dev_move).toContain('if (state.error) refusal_reason = String(state.error)')

    const refusal = dev_move.indexOf('if (!committed)')
    const success = dev_move.indexOf('return { ok: true')
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(success)
    expect(dev_move.slice(refusal, success)).toContain('refusal_reason')
  })
})
