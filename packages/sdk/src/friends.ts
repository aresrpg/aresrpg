// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID } from '@mysten/sui/utils'

import { receipt_digest } from './cache.ts'
import { owned_ref } from './cache.ts'
import { SDK } from './client.ts'

type GameSdk = ReturnType<typeof SDK>

const friend_registry = (sdk: GameSdk): string => {
  const id = (sdk.pins.friend_registry as Readonly<{ id?: unknown }> | undefined)?.id
  if (typeof id !== 'string') throw new Error('Friend actions are unavailable: the FriendRegistry pin is missing.')
  return id
}

export const friend_list_id = (registry: string, type_package: string, owner: string): string =>
  deriveObjectID(registry, `${type_package}::friends::FriendKey`, bcs.Address.serialize(owner).toBytes())

export const friends_actions = (sdk: GameSdk, { address }: Readonly<{ address: string }>) => {
  const list_id = () => {
    const type_package = sdk.game_type_package
    if (!type_package) throw new Error('Friend actions are unavailable: the defining package is missing.')
    return friend_list_id(friend_registry(sdk), type_package, address)
  }
  const hydrate = async (): Promise<boolean> => {
    const list = list_id()
    await sdk.hydrate_unknown([list])
    return owned_ref(sdk.cache, list) !== undefined
  }
  return Object.freeze({
    get list() {
      return list_id()
    },
    add: async (who: string) => {
      const list = list_id()
      const exists = await hydrate()
      const tx = sdk.tx()
      if (exists) sdk.doors.set_friend(tx, { list, addr: who, present: true })
      else sdk.doors.create_friend_list(tx, { first: who })
      return Object.freeze({ digest: receipt_digest(await sdk.execute(tx)), list })
    },
    remove: async (who: string) => {
      const list = list_id()
      if (!(await hydrate())) throw new Error('This wallet has no friend list.')
      const tx = sdk.tx()
      sdk.doors.set_friend(tx, { list, addr: who, present: false })
      return Object.freeze({ digest: receipt_digest(await sdk.execute(tx)), list })
    },
  })
}

export type FriendsActions = ReturnType<typeof friends_actions>
