// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { DISPLAY_REGISTRY_ID } from './deployment_admin.ts'
import type { SDK } from './client.ts'
import { receipt_event, receipt_digest } from './cache.ts'

export type TournamentSettings = Readonly<{
  admin: string
  name: string
  format: 1 | 3 | 6
  start_before_ms: number
  entry_fee_mist: bigint
  max_level: number | null
  sui_bps: readonly number[]
  token_bps: readonly number[]
  rewards: readonly Readonly<{ template: string; place: number; amount: number }>[]
}>

export const tournament_admin_actions = (
  sdk: ReturnType<typeof SDK>,
  recipient: string,
  client: Pick<SuiGrpcClient, 'movePackageService'>
) =>
  Object.freeze({
    setup_display: async () => {
      const { publisher, package: package_id } = sdk.pins
      if (typeof publisher !== 'string' || typeof package_id !== 'string')
        throw new Error('The game Publisher is not configured.')
      await sdk.hydrate_unknown([publisher, DISPLAY_REGISTRY_ID])
      const tx = sdk.tx()
      const response = await client.movePackageService.getDatatype({
        packageId: package_id,
        moduleName: 'tournament',
        name: 'Tournament',
      }).response
      const origin = response.datatype?.definingId
      if (!origin) throw new Error('The deployed package has no tournament type origin.')
      const type = `${origin}::tournament::Tournament`
      const [display, cap] = tx.moveCall({
        target: '0x2::display_registry::new_with_publisher',
        typeArguments: [type],
        arguments: [sdk.door_context.obj(tx, DISPLAY_REGISTRY_ID, true), sdk.door_context.obj(tx, publisher, false)],
      })
      const fields = {
        name: '{name}',
        description: 'AresRPG tournament — {status}',
        link: 'https://app.aresrpg.world/kolizeum',
        project_url: 'https://aresrpg.world',
        creator: 'AresRPG',
      }
      Object.entries(fields).forEach(([name, value]) => {
        tx.moveCall({
          target: '0x2::display_registry::set',
          typeArguments: [type],
          arguments: [display, cap, tx.pure.string(name), tx.pure.string(value)],
        })
      })
      tx.moveCall({ target: '0x2::display_registry::share', typeArguments: [type], arguments: [display] })
      tx.transferObjects([cap], recipient)
      return sdk.execute(tx)
    },
    create: async (settings: TournamentSettings) => {
      await sdk.hydrate_unknown([settings.admin, ...settings.rewards.map(({ template }) => template)])
      const tx = sdk.tx()
      const rewards = settings.rewards.reduce(
        (list, reward) => sdk.doors.tournament_add_reward(tx, { ...reward, rewards: list }),
        sdk.doors.tournament_rewards(tx, {})
      )
      sdk.doors.tournament_create_with_rules(tx, { ...settings, rewards })
      const receipt = await sdk.execute(tx)
      const event = receipt_event(receipt, '::tournament::TournamentUpdated')
      if (typeof event?.tournament !== 'string') throw new Error('Tournament creation receipt lacks its identity.')
      return Object.freeze({ digest: receipt_digest(receipt), tournament: event.tournament })
    },
    start: async (tournament: string) => {
      await sdk.hydrate_unknown([tournament])
      const tx = sdk.tx()
      sdk.doors.start_tournament(tx, { tournament })
      return sdk.execute(tx)
    },
    cancel: async (t: string, admin: string, pool?: string | null) => {
      await sdk.hydrate_unknown([t, admin, ...(pool ? [pool] : [])])
      const tx = sdk.tx()
      sdk.doors.tournament_cancel(tx, { t, admin })
      if (pool) sdk.doors.tournament_refund_kares(tx, { t, pool })
      return sdk.execute(tx)
    },
  })
