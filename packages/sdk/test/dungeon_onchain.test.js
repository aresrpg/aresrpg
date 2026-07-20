// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  dungeon_deployment,
  dungeon_deployment_ready,
} from '../src/deployment/dungeon.js'
import { abandon_ptb } from '../src/sui/write/dungeon_run.js'
import { get_run_pass } from '../src/sui/read/dungeon.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  find_call,
} from './_onchain_fixtures.js'

describe('dungeon_deployment — the loud unset gate (shim over the ONE merged home)', () => {
  test('testnet is STAMPED (post-ceremony); mainnet stays DARK until its ceremony', () => {
    expect(dungeon_deployment_ready('testnet')).toBe(true)
    expect(dungeon_deployment_ready('mainnet')).toBe(false)
    expect(() => dungeon_deployment('testnet')).not.toThrow()
    expect(() => dungeon_deployment('mainnet')).toThrow(/not deployed/)
    expect(() => dungeon_deployment('mainnet')).toThrow(/PACKAGE_ID/)
  })
  test('unknown network throws the distinct message; the override seam resolves', () => {
    expect(() => dungeon_deployment('devnet')).toThrow(/no aresrpg ids/)
    expect(dungeon_deployment('testnet', IDS.aresrpg).VERSION).toBe(
      IDS.aresrpg.VERSION,
    )
  })
})

describe('dungeon abandon builder', () => {
  const run_args = {
    run_pass_id: id('r0'),
    kiosk_id: id('k0'),
    personal_kiosk_cap_id: id('pk0'),
  }
  test('refuses loudly when undeployed', () => {
    expect(() => abandon_ptb(undeployed_context)(run_args)).toThrow(
      /not deployed/,
    )
  })
  test('→ dungeon::abandon, 5 args, merged package', () => {
    const call = find_call(
      abandon_ptb(deployed_context)(run_args),
      'dungeon::abandon',
    )
    expect(call).toBeDefined()
    expect(call.package).toBe(IDS.aresrpg.DUNGEON_PACKAGE_ID)
    expect(call.args).toBe(5)
  })
})

describe('get_run_pass — bound-run read', () => {
  test('returns null when unreadable', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await get_run_pass({ grpc_client })(id('r0'))).toBeNull()
  })
  test('decodes world / room / owner / character / return position', async () => {
    const grpc_client = {
      core: {
        getObject: async () => ({
          object: {
            json: {
              id: id('r0'),
              world: id('w0'),
              room: 2,
              owner: id('0a'),
              character: id('ca0'),
              return_x: 5,
              return_z: 7,
            },
          },
        }),
      },
    }
    const pass = await get_run_pass({ grpc_client })(id('r0'))
    expect(pass.room).toBe(2)
    expect(pass.world).toBe(id('w0'))
    expect(pass.character).toBe(id('ca0'))
    expect(pass.return_x).toBe(5)
    expect(pass.return_z).toBe(7)
  })
})
