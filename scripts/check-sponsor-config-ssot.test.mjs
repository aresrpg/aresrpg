// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2197 — the sponsor-config SSOT gate's own teeth. A gate nobody has watched FAIL is a gate nobody
// can trust to fail: each rule below is driven against a fixture that violates it and one that does
// not, so a future edit that quietly declaws the checker reds here instead of passing forever.
// Pure — fixtures in memory, no tree reads, no network.

import { describe, expect, test } from 'bun:test'

import {
  dual_home_errors,
  env_names_read,
  ghost_knob_errors,
  key_shape,
  sponsor_key_shapes,
  store_contract_errors,
} from './check-sponsor-config-ssot.mjs'

const reads = (rows) => new Map(rows.map(([name, names]) => [name, new Set(names)]))

describe('env-name extraction reads every form the tree actually uses', () => {
  test('process.env.X, process.env["X"] and an injected env.X are all seen', () => {
    const found = env_names_read(
      [
        'const a = process.env.SPONSOR_ADDR_DAILY_CAP_MIST || 1',
        'const b = process.env["SPONSOR_RL_MAX"]',
        'const c = env.GAS_POOL_DAILY_CAP ?? "200000000"',
      ].join('\n')
    )
    expect([...found].sort()).toEqual(['GAS_POOL_DAILY_CAP', 'SPONSOR_ADDR_DAILY_CAP_MIST', 'SPONSOR_RL_MAX'])
  })

  test('a name that only appears in prose is NOT a read (blind guard — the class the gate exists for)', () => {
    // A comment naming the other half's env is exactly the "kept equal by prose" arrangement #2197 killed.
    expect(env_names_read('// MUST match SPONSOR_ADDR_DAILY_CAP_MIST on the sponsor service').size).toBe(0)
  })
})

describe('rule 1 — no setting has two homes', () => {
  const one_home = reads([
    ['sponsor', ['SPONSOR_ADDR_DAILY_CAP_MIST']],
    ['rpc-api', ['REDIS_URL']],
  ])

  test('a setting read by one deployable passes', () => {
    expect(dual_home_errors(one_home, {})).toEqual([])
  })

  test('the SAME setting read by two deployables fails, naming both', () => {
    const two_homes = reads([
      ['sponsor', ['SPONSOR_ADDR_DAILY_CAP_MIST']],
      ['rpc-api', ['SPONSOR_ADDR_DAILY_CAP_MIST']],
    ])
    const errors = dual_home_errors(two_homes, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SPONSOR_ADDR_DAILY_CAP_MIST')
    expect(errors[0]).toContain('rpc-api, sponsor')
  })

  test('a justified platform seam passes — order of the deployable list does not matter', () => {
    const seam_reads = reads([
      ['sponsor', ['GAS_STATION_AUTH']],
      ['rpc-gas-pool', ['GAS_STATION_AUTH']],
    ])
    const seams = {
      GAS_STATION_AUTH: {
        deployables: ['sponsor', 'rpc-gas-pool'], // deliberately NOT sorted
        reason: 'a shared bearer across an auth boundary — a secret cannot be derived from the other side',
      },
    }
    expect(dual_home_errors(seam_reads, seams)).toEqual([])
  })

  test('a seam with a token reason does NOT excuse the duplicate (the escape hatch has a floor)', () => {
    const seam_reads = reads([
      ['sponsor', ['GAS_STATION_AUTH']],
      ['rpc-gas-pool', ['GAS_STATION_AUTH']],
    ])
    expect(
      dual_home_errors(seam_reads, { GAS_STATION_AUTH: { deployables: ['sponsor', 'rpc-gas-pool'], reason: 'meh' } })
    ).toHaveLength(1)
  })

  test('a seam justified for the WRONG pair does not launder a third reader', () => {
    const three = reads([
      ['sponsor', ['GAS_STATION_AUTH']],
      ['rpc-gas-pool', ['GAS_STATION_AUTH']],
      ['rpc-api', ['GAS_STATION_AUTH']],
    ])
    const seams = {
      GAS_STATION_AUTH: {
        deployables: ['sponsor', 'rpc-gas-pool'],
        reason: 'a shared bearer across an auth boundary — a secret cannot be derived from the other side',
      },
    }
    expect(dual_home_errors(three, seams)).toHaveLength(1)
  })
})

describe('rule 2 — no ghost knobs', () => {
  test('a declared setting nobody reads fails (the SPONSOR_DAILY_CAP_MIST class)', () => {
    const errors = ghost_knob_errors(
      new Set(['SPONSOR_ADDR_DAILY_CAP_MIST', 'SPONSOR_DAILY_CAP_MIST']),
      reads([['sponsor', ['SPONSOR_ADDR_DAILY_CAP_MIST']]])
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('SPONSOR_DAILY_CAP_MIST')
  })

  test('a setting declared and read by ANY deployable passes', () => {
    expect(ghost_knob_errors(new Set(['SPONSOR_GAS_BUDGET']), reads([['sponsor', ['SPONSOR_GAS_BUDGET']]]))).toEqual([])
  })

  test('a setting read but not declared is NOT an error — deploy charts are out of this tree', () => {
    expect(ghost_knob_errors(new Set(), reads([['sponsor', ['SPONSOR_ZKLOGIN_ISS']]]))).toEqual([])
  })
})

describe('rule 3 — the shared-store contract holds by SHAPE', () => {
  test('interpolations collapse, so renaming a variable is not drift', () => {
    expect(key_shape('sponsor:spent:${utc_date()}:${address.toLowerCase()}')).toBe('sponsor:spent:{}:{}')
    expect(key_shape('sponsor:spent:${day}:${addr.toLowerCase()}')).toBe('sponsor:spent:{}:{}')
    expect(key_shape('sponsor:cap:addr_daily_mist')).toBe('sponsor:cap:addr_daily_mist')
  })

  test('only sponsor: keys are collected — indexer projections are a different owner', () => {
    const shapes = sponsor_key_shapes('const a = `sponsor:cap:x`; const b = `rpc:character:${id}`')
    expect([...shapes]).toEqual(['sponsor:cap:x'])
  })

  test('a reader key the writer never writes fails, quoting the shape', () => {
    const errors = store_contract_errors(
      new Set(['sponsor:spent:{}:{}']),
      new Set(['sponsor:spent:{}:{}', 'sponsor:cap:addr_daily_mist'])
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('sponsor:cap:addr_daily_mist')
  })

  test('reader ⊆ writer passes — the writer may own keys nobody displays', () => {
    expect(
      store_contract_errors(
        new Set(['sponsor:spent:{}:{}', 'sponsor:cap:addr_daily_mist', 'sponsor:resv:{}']),
        new Set(['sponsor:spent:{}:{}', 'sponsor:cap:addr_daily_mist'])
      )
    ).toEqual([])
  })

  test('a renamed key on ONE side is caught — the whole point of pinning shapes', () => {
    expect(
      store_contract_errors(new Set(['sponsor:cap:addr_daily_mist']), new Set(['sponsor:cap:daily_mist']))
    ).toHaveLength(1)
  })
})
