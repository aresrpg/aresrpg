// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  game_deployment,
  game_deployment_ready,
} from '../src/deployment/game.js'
import {
  join_world_ptb,
  search_zone_ptb,
  gather_ptb,
} from '../src/sui/write/game_world.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

describe('game_deployment — the loud unset gate (shim over the ONE merged home)', () => {
  test('testnet is STAMPED (post-ceremony); mainnet stays DARK until its ceremony', () => {
    expect(game_deployment_ready('testnet')).toBe(true)
    expect(game_deployment_ready('mainnet')).toBe(false)
    expect(() => game_deployment('testnet')).not.toThrow()
    expect(() => game_deployment('mainnet')).toThrow(/not deployed/)
    expect(() => game_deployment('mainnet')).toThrow(/PACKAGE_ID/)
  })
  test('throws on an unknown network with the distinct message', () => {
    expect(() => game_deployment('devnet')).toThrow(/no aresrpg ids/)
  })
  test('resolves when full ids are injected (the override seam)', () => {
    expect(game_deployment('testnet', IDS.aresrpg).GAME_CONFIG).toBe(
      IDS.aresrpg.GAME_CONFIG,
    )
    // a partial override over the EMPTY mainnet map still refuses (missing keys listed)
    expect(() => game_deployment('mainnet', { PACKAGE_ID: id('x0') })).toThrow(
      /VERSION/,
    )
  })
})

const args = {
  world_id: id('w0'),
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  zx: 1,
  zy: 2,
  node_index: 3,
  template_id: id('7e0'),
  protector_template_id: id('mob0'), // §17.22 ambush MobTemplate (required — no inert default)
}

describe('game builders — refuse loudly when undeployed', () => {
  test('join_world_ptb refuses (construction safe, throws at invoke)', () => {
    expect(() => join_world_ptb(undeployed_context)).not.toThrow()
    expect(() => join_world_ptb(undeployed_context)(args)).toThrow(
      /not deployed/,
    )
  })
  test('search_zone_ptb + gather_ptb refuse', () => {
    expect(() => search_zone_ptb(undeployed_context)(args)).toThrow(
      /not deployed/,
    )
    expect(() => gather_ptb(undeployed_context)(args)).toThrow(/not deployed/)
  })
})

describe('game builders — target strings + arg shapes', () => {
  test('join_world → zones::join_world, 8 args (link + second version died), terminal random, merged package', () => {
    const tx = join_world_ptb(deployed_context)(args)
    const call = find_call(tx, 'zones::join_world')
    expect(call).toBeDefined()
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(8)
    // random (0x8) is the LAST move call in the tx → Random-PTB compliant
    expect(targets(tx).at(-1)).toBe('zones::join_world')
  })
  test('search_zone → zones::search_zone, 10 args (link + second version died)', () => {
    const call = find_call(
      search_zone_ptb(deployed_context)(args),
      'zones::search_zone',
    )
    expect(call.args).toBe(10)
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
  })
  test('gather → gathering::gather, 17 args (§6 rare_template + §17.22 registry/protector/engine_version added), terminal random', () => {
    const tx = gather_ptb(deployed_context)(args)
    const call = find_call(tx, 'gathering::gather')
    // 14 (prior) + 3 §17.22 ambush args (registry &mut FightRegistry, protector_template &MobTemplate,
    // engine_version &EngineVersion) inserted between policy and config — pinned against the Move source.
    expect(call.args).toBe(17)
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    // &Random (0x8) is the LAST move call in the tx → Random-PTB compliant
    expect(targets(tx).at(-1)).toBe('gathering::gather')
  })
})

// `get_world`'s READ tests moved to world_inner.test.js: a World's state now lives in a version-wrapped
// payload (#1289), so every read test must drive the REAL wrapped serialization — the flat-shell mocks that
// used to live here passed against a decoder that returned a zeroed world (PR #1315 review finding 2).
