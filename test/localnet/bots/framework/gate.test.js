// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { ENV_FAIL, PRODUCT_FAIL, exit_code_for, run_boot_gate, run_leg_gate } from './gate.js'

describe('fight-bot CI gate determinism (#1165)', () => {
  test('the landed timeout helper emits the bounded operation name', async () => {
    const { with_timeout } = await import('../../../../scripts/fight_bots.mjs')
    await expect(with_timeout('solo leg completes', () => new Promise(() => {}), 10)).rejects.toThrow(
      'TIMEOUT after 10ms running: solo leg completes'
    )
  })

  test('boot-class failures retry once inside one outer boot bound', async () => {
    let attempts = 0
    const bounds = []
    const result = await run_boot_gate({
      boot: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('RPC health check refused')
        return { chain_id: 'localnet' }
      },
      bound: async (label, effect, timeout_ms) => {
        bounds.push({ label, timeout_ms })
        return effect()
      },
      timeout_ms: 90,
    })

    expect(result).toEqual({ chain_id: 'localnet' })
    expect(attempts).toBe(2)
    expect(bounds).toEqual([{ label: 'fight-bot boot completes', timeout_ms: 90 }])
  })

  test('a persistent boot failure is ENV-FAIL after exactly two attempts', async () => {
    let attempts = 0
    await expect(
      run_boot_gate({
        boot: async () => {
          attempts += 1
          throw new Error(`boot refused ${attempts}`)
        },
        bound: (_label, effect) => effect(),
        timeout_ms: 90,
      })
    ).rejects.toMatchObject({
      failure_kind: ENV_FAIL,
      message: 'boot refused 2',
    })
    expect(attempts).toBe(2)
    expect(exit_code_for(ENV_FAIL)).toBe(2)
  })

  test('a leg timeout is a named PRODUCT-FAIL row and never retries', async () => {
    let attempts = 0
    const row = await run_leg_gate({
      name: 'coop',
      run: async () => {
        attempts += 1
      },
      input: {},
      bound: async (label, _effect, timeout_ms) => {
        throw new Error(`TIMEOUT after ${timeout_ms}ms running: ${label}`)
      },
      timeout_ms: 120,
    })

    expect(row).toMatchObject({
      leg: 'coop',
      ok: false,
      failure_kind: PRODUCT_FAIL,
      error: 'TIMEOUT after 120ms running: coop leg completes',
    })
    expect(attempts).toBe(0)
    expect(exit_code_for(PRODUCT_FAIL)).toBe(1)
  })

  test('timeout mechanics remain in one helper while the drive consumes the gate policy', () => {
    const runner = readFileSync(new URL('../../../../scripts/fight_bots.mjs', import.meta.url), 'utf8')
    const gate = readFileSync(new URL('./gate.js', import.meta.url), 'utf8')

    expect(runner.match(/function with_timeout/g)).toHaveLength(1)
    expect(gate).not.toContain('Promise.race')
    expect(runner).toContain('run_boot_gate')
    expect(runner).toContain('run_leg_gate')
    expect(runner).toContain('import.meta.main')
  })
})
