// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { resolve_env } from '../src/env.ts'

describe('frontend environment', () => {
  test('a bare build has complete public defaults', () => {
    const env = resolve_env({})

    expect(env.app_url).toBe('https://aresrpg.world/')
    expect(env.network).toBe('testnet')
    expect(env.engine_quality).toBe('medium')
    expect(env.graphql_url).toBe('https://graphql.testnet.sui.io/graphql')
    expect(env.sui_rpc_url).toBe('https://fullnode.testnet.sui.io:443')
    expect(env.server_ws_url).toBe('ws://localhost:9800/')
    expect(env.social_image_url).toBe('https://aresrpg.world/og-image.png')
  })

  test('one app URL drives canonical and social asset URLs', () => {
    const env = resolve_env({ VITE_APP_URL: 'https://preview.example/game/' })

    expect(env.app_url).toBe('https://preview.example/game/')
    expect(env.social_image_url).toBe('https://preview.example/game/og-image.png')
  })

  test('unsupported networks fail during configuration', () => {
    expect(() => resolve_env({ VITE_NETWORK: 'devnet' })).toThrow('Unsupported VITE_NETWORK: devnet')
  })

  test('unsupported engine quality fails during configuration', () => {
    expect(() => resolve_env({ VITE_ENGINE_QUALITY: 'ultra' })).toThrow('Unsupported VITE_ENGINE_QUALITY: ultra')
  })
})
