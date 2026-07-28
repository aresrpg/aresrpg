// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { world_to_biome } from '../follow'
import { _reset_for_test as reset_world_biome_for_test } from '../world-shell/world_biome.js'

import { _reset_rpc_client_for_test, get_characters, get_config, get_sponsor_remaining, get_status } from './client'

const real_fetch = globalThis.fetch
const real_date_now = Date.now

const response_for = (path: string): Response => {
  if (path === '/v1/characters') return Response.json({ characters: [] })
  if (path === '/v1/config') return Response.json({ enabled: true, dials: {} })
  if (path === '/v1/sponsor/remaining')
    return Response.json({
      allowance_mist: '0',
      spent_mist: '0',
      remaining_mist: '0',
      resets_at: null,
    })
  if (path === '/v1/status') return Response.json({ status: 'ok', committer_watermark: 1 })
  if (path === '/v1/encyclopedia')
    return Response.json({ items: [], mobs: [], worlds: [{ world_id: 'world-boot', biome: 'arctic' }], recipes: [] })
  return Response.json({})
}

beforeEach(() => {
  _reset_rpc_client_for_test()
  reset_world_biome_for_test()
})

afterEach(() => {
  globalThis.fetch = real_fetch
  Date.now = real_date_now
  _reset_rpc_client_for_test()
  reset_world_biome_for_test()
})

describe('cold world-route network pin (#1449)', () => {
  test('issues the four boot reads together without the steady-state stagger', async () => {
    const issued: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      issued.push(url.pathname)
      return response_for(url.pathname)
    }) as unknown as typeof fetch

    const boot_reads = [
      get_status(),
      get_sponsor_remaining('0xboot'),
      get_config(),
      get_characters({ owner: '0xboot' }),
    ]
    void Promise.allSettled(boot_reads)
    await Bun.sleep(0)

    expect(issued).toHaveLength(4)
    expect(new Set(issued)).toEqual(new Set(['/v1/status', '/v1/sponsor/remaining', '/v1/config', '/v1/characters']))
    await Promise.all(boot_reads)
  })

  test('the resident world boot issues no encyclopedia request', async () => {
    const issued: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      issued.push(url.pathname)
      return response_for(url.pathname)
    }) as unknown as typeof fetch

    await world_to_biome('world-boot')

    expect(issued.filter((path) => path === '/v1/encyclopedia')).toHaveLength(0)
  })

  test('shares one config response across the whole boot window', async () => {
    let now_ms = 0
    Date.now = () => now_ms
    const issued: string[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      issued.push(url.pathname)
      return response_for(url.pathname)
    }) as unknown as typeof fetch

    await get_config()
    now_ms += 3001
    await get_config()

    expect(issued.filter((path) => path === '/v1/config')).toHaveLength(1)
  })
})
