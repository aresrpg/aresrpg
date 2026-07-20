// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  create_friend_list_ptb,
  add_friend_ptb,
  remove_friend_ptb,
} from '../src/sui/write/social_friends.js'
import {
  get_friend_list,
  get_friend_list_by_owner,
} from '../src/sui/read/friends.js'

import {
  IDS,
  id,
  deployed_context,
  undeployed_context,
  targets,
  find_call,
} from './_onchain_fixtures.js'

const list = { friend_list_id: id('fl0') }
const who = '0x00000000000000000000000000000000000000000000000000000000000000ab'

describe('friends builders — refuse loudly when undeployed', () => {
  test('every builder refuses (core ids unset)', () => {
    expect(() => create_friend_list_ptb(undeployed_context)()).toThrow(
      /not deployed/,
    )
    expect(() =>
      add_friend_ptb(undeployed_context)({ ...list, addr: who }),
    ).toThrow(/not deployed/)
    expect(() =>
      remove_friend_ptb(undeployed_context)({ ...list, addr: who }),
    ).toThrow(/not deployed/)
  })
  test('social singletons are guarded even when the CORE package is deployed', () => {
    const no_registry = {
      ...deployed_context,
      ids: { aresrpg: { ...IDS.aresrpg, SOCIAL_FRIEND_REGISTRY: '' } },
    }
    expect(() => create_friend_list_ptb(no_registry)()).toThrow(
      /SOCIAL_FRIEND_REGISTRY/,
    )
    const no_pkg = {
      ...deployed_context,
      ids: { aresrpg: { ...IDS.aresrpg, SOCIAL_PACKAGE_ID: '' } },
    }
    expect(() => add_friend_ptb(no_pkg)({ ...list, addr: who })).toThrow(
      /SOCIAL_PACKAGE_ID/,
    )
  })
})

describe('friends builders — target strings + arg shapes (STANDALONE social package)', () => {
  test('create_friend_list → friends::create_friend_list, 2 args, social package', () => {
    const tx = create_friend_list_ptb(deployed_context)()
    expect(targets(tx)).toEqual(['friends::create_friend_list'])
    const call = find_call(tx, 'friends::create_friend_list')
    expect(call.args).toBe(2) // registry + version
    expect(call.package).toBe(IDS.aresrpg.SOCIAL_PACKAGE_ID) // NOT the core PACKAGE_ID
    expect(call.package).not.toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
  })
  test('add_friend → friends::add_friend, 3 args', () => {
    const call = find_call(
      add_friend_ptb(deployed_context)({ ...list, addr: who }),
      'friends::add_friend',
    )
    expect(call.args).toBe(3) // list + addr + version
    expect(call.package).toBe(IDS.aresrpg.SOCIAL_PACKAGE_ID)
  })
  test('remove_friend → friends::remove_friend, 3 args', () => {
    const call = find_call(
      remove_friend_ptb(deployed_context)({ ...list, addr: who }),
      'friends::remove_friend',
    )
    expect(call.args).toBe(3) // list + addr + version
    expect(call.package).toBe(IDS.aresrpg.SOCIAL_PACKAGE_ID)
  })
})

describe('get_friend_list — soulbound whitelist read', () => {
  test('returns null when unreadable', async () => {
    const grpc_client = { core: { getObject: async () => ({ object: null }) } }
    expect(await get_friend_list({ grpc_client })(id('fl0'))).toBeNull()
  })
  test('decodes owner + VecSet friends ({ contents: [...] })', async () => {
    const grpc_client = {
      core: {
        getObject: async () => ({
          object: {
            json: {
              id: id('fl0'),
              owner: id('0a'),
              friends: { contents: [who, id('0b')] },
            },
          },
        }),
      },
    }
    const fl = await get_friend_list({ grpc_client })(id('fl0'))
    expect(fl.owner).toBe(id('0a'))
    expect(fl.friends).toEqual([who, id('0b')])
  })
  test('tolerates a bare-array VecSet render and an absent set', async () => {
    const bare = {
      grpc_client: {
        core: {
          getObject: async () => ({
            object: {
              json: { id: id('fl0'), owner: id('0a'), friends: [who] },
            },
          }),
        },
      },
    }
    expect((await get_friend_list(bare)(id('fl0'))).friends).toEqual([who])
    const empty = {
      grpc_client: {
        core: {
          getObject: async () => ({
            object: { json: { id: id('fl0'), owner: id('0a') } },
          }),
        },
      },
    }
    expect((await get_friend_list(empty)(id('fl0'))).friends).toEqual([])
  })
})

describe('get_friend_list_by_owner — resolve the soulbound list by owner address', () => {
  const owner = id('0a')
  // testnet carries a stamped SOCIAL_PACKAGE_ID in the deployment home, so aresrpg_id resolves the type string.
  const make = (owned, obj) => ({
    network: 'testnet',
    grpc_client: {
      core: { listOwnedObjects: async () => owned, getObject: async () => obj },
    },
  })
  test('null when the social package is unstamped on the network', async () => {
    const ctx = {
      network: 'devnet',
      grpc_client: {
        core: {
          listOwnedObjects: async () => ({
            objects: [{ objectId: id('fl0') }],
          }),
        },
      },
    }
    expect(await get_friend_list_by_owner(ctx)(owner)).toBeNull()
  })
  test('null when the account has no FriendList', async () => {
    expect(
      await get_friend_list_by_owner(make({ objects: [] }))(owner),
    ).toBeNull()
  })
  test('decodes the owned FriendList', async () => {
    const ctx = make(
      { objects: [{ objectId: id('fl0') }] },
      {
        object: {
          json: { id: id('fl0'), owner, friends: { contents: [who] } },
        },
      },
    )
    const fl = await get_friend_list_by_owner(ctx)(owner)
    expect(fl.id).toBe(id('fl0'))
    expect(fl.friends).toEqual([who])
  })
  test('swallows a grpc throw → null (best-effort read)', async () => {
    const ctx = {
      network: 'testnet',
      grpc_client: {
        core: {
          listOwnedObjects: async () => {
            throw new Error('grpc down')
          },
        },
      },
    }
    expect(await get_friend_list_by_owner(ctx)(owner)).toBeNull()
  })
})
