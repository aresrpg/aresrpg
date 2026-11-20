// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { resolve_env } from '../src/env.ts'

describe('frontend environment', () => {
  test('a bare build has complete public defaults', () => {
    const env = resolve_env({})

    expect(env.privy_app_id).toBe('cmvpm31db00nk0gimsyylhwzk')
    expect(env.app_url).toBe('https://aresrpg.world/')
    expect(env.network).toBe('mainnet')
    expect(env.engine_quality).toBe('medium')
    expect(env.graphql_url).toBe('https://graphql.mainnet.sui.io/graphql')
    expect(env.sui_rpc_url).toBe('https://fullnode.mainnet.sui.io:443')
    expect(env.server_ws_url).toBe('ws://localhost:9800/')
    expect(env.social_image_url).toBe('https://aresrpg.world/social/home.jpg')
  })

  test('only a local or edge build offers the development sign-in', () => {
    const offered = (deployment?: string) => resolve_env({ VITE_DEPLOY_ENV: deployment }).dev_sign_in
    expect([offered('local'), offered('preview')]).toEqual([true, true])
    expect([offered('production'), offered('development'), offered()]).toEqual([false, false, false])
  })

  test('one app URL drives canonical and social asset URLs', () => {
    const env = resolve_env({ VITE_APP_URL: 'https://preview.example/game/' })

    expect(env.app_url).toBe('https://preview.example/game/')
    expect(env.social_image_url).toBe('https://preview.example/game/social/home.jpg')
  })

  test('unsupported networks fail during configuration', () => {
    expect(() => resolve_env({ VITE_NETWORK: 'devnet' })).toThrow('Unsupported VITE_NETWORK: devnet')
  })

  test('unsupported engine quality fails during configuration', () => {
    expect(() => resolve_env({ VITE_ENGINE_QUALITY: 'ultra' })).toThrow('Unsupported VITE_ENGINE_QUALITY: ultra')
  })
})
