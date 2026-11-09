// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { SDK, type SuiTransport } from '@aresrpg/sdk'
import { Transaction } from '@mysten/sui/transactions'
import { create_agent_multisig } from '@aresrpg/sdk/agent-multisig'
import { create_agent_transaction_signer } from '@aresrpg/sdk/agent-transactions'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { fromBase64 } from '@mysten/sui/utils'
import { recipe_id, item_template_id } from '@aresrpg/sdk/seed-ids'

import { fake_client, pins, id, digest } from '../../sdk/test/helpers/transport.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { create_transaction_journal } from '../src/transaction_journal.ts'
import { profession_tick } from '../src/profession_runtime.ts'
import { execute_gameplay } from '../src/gameplay.ts'
import type { ProfessionRun } from '../src/profession_control.ts'
import type { ProvisionRequest } from '../src/provisioning.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { profession_context, plan, character, item, recipe, resource } from './helpers/profession_fixture.ts'

test('profession plan reaches real SDK gather and craft PTBs through the durable journal using only fixture transport', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lease = await control.acquire(f.bot, 'actor', 10000)
  const lane_key = lane_key_for(f.bot)
  await control.observed(lane_key, 'actor', lease.fence, true)
  const started = await control.start_profession(f.grant, {
    idempotency_key: 'sdk',
    plan,
    decision_revision: 0,
    observation_revision: 1,
  })
  if (!('run' in started)) throw new Error('run missing')
  const source = profession_context()
  const provision = (await f.store.read<ProvisionRequest>('provision:bot'))!
  const member = f.options.provider.signer(provision.key!)
  const identity = create_agent_multisig({
    agent_public_key: member.public_key,
    zklogin_public_identifier: ZkLoginPublicIdentifier.fromBytes(fromBase64(f.bot.zklogin_public_identifier)),
    sign_personal_message: member.sign_personal_message,
  })
  const session_pins = {
    ...pins,
    package_original: pins.package,
    content_root: { id: id(61), shared_version: '1' },
    seed_package_original: id(60),
  }
  const calls: string[] = []
  const includes: unknown[] = []
  const chain = fake_client({ simulate_ok: true })
  const client = {
    ...chain,
    core: {
      ...chain.core,
      executeTransaction: async (input: { transaction: Uint8Array; include?: { objectTypes?: boolean } }) => {
        const names = Transaction.from(input.transaction)
          .getData()
          .commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : []))
        const kind = names.includes('craft') ? 'craft' : 'gather'
        calls.push(kind)
        includes.push(input.include)
        const receipt = await chain.core.executeTransaction(input)
        const event =
          kind === 'gather'
            ? {
                type: `${pins.package}::gathering::ResourceGathered`,
                json: { quantity: 2, protector: false, job_xp_gained: '1' },
              }
            : {
                type: `${pins.package}::crafting::Crafted`,
                json: {
                  recipe: recipe_id(id(61), id(60), recipe.output_type),
                  character: character.id,
                  output_template: item_template_id(id(61), id(60), recipe.output_type),
                  attempts: 1,
                  successes: 1,
                  job_xp_gained: 10,
                },
              }
        return {
          ...receipt,
          Transaction: {
            ...receipt.Transaction!,
            events: [event],
            objectTypes: input.include?.objectTypes ? {} : undefined,
            effects: {
              ...receipt.Transaction!.effects!,
              lamportVersion: '2',
              gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
            },
          },
        }
      },
    },
  } as unknown as SuiTransport
  for (const revision of [1, 2]) {
    const run = (await f.store.read<ProfessionRun>(`profession:${started.run.id}`))!
    const snapshot = {
      ...source.snapshot,
      observation_revision: revision,
      characters:
        revision === 1 ? source.snapshot.characters : [{ ...character, at_ms: 1, jobs: { [resource.job]: '1' } }],
      zones:
        revision === 1
          ? source.snapshot.zones
          : {
              ...source.snapshot.zones,
              'fixture:97:97': {
                ...source.snapshot.zones['fixture:97:97']!,
                zone: { ...source.snapshot.zones['fixture:97:97']!.zone, res_taken: [1] },
              },
            },
      inventory:
        revision === 1
          ? source.snapshot.inventory
          : {
              ...source.snapshot.inventory!,
              items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index)),
            },
    }
    const context = {
      ...source,
      address: f.bot.address,
      snapshot,
      command: { ...source.command, observation_revision: revision },
    }
    await profession_tick({
      store: f.store,
      config: f.options.config,
      run,
      actor_id: 'actor',
      fence: lease.fence,
      context,
      now: f.clock.now,
    })
    const admitted = (await f.store.read<ProfessionRun>(`profession:${run.id}`))!
    expect(admitted.actions_started).toBe(revision)
    const command = (await f.store.read<Command>(`command:${admitted.last_command_id}`))!
    const journal = create_transaction_journal(
      f.store,
      f.options.config,
      f.options.cipher,
      { command, actor_id: 'actor', fence: lease.fence },
      () => f.clock.now
    )
    const sdk = SDK({
      client,
      network: 'mainnet',
      pins: session_pins,
      address: f.bot.address,
      transaction_storage: null,
      transaction_journal: journal,
      sign_transaction: create_agent_transaction_signer(identity, member.sign_transaction),
    })
    const observed_sdk = {
      ...sdk,
      get_owned_kiosks: async () => ({
        kioskOwnerCaps: [
          { objectId: character.kiosk_cap!, kioskId: character.kiosk, isPersonal: true, version: '1', digest },
        ],
        kioskIds: [character.kiosk],
        hasNextPage: false,
        nextCursor: null,
      }),
    }
    await execute_gameplay({ ...context, command, sdk: observed_sdk })
    expect((await f.store.read<Command>(`command:${command.id}`))?.status).toBe('completed')
    expect((await f.store.read<Lane>(lane_key))?.pending).toBeNull()
    await control.observed(lane_key, 'actor', lease.fence, true)
  }
  expect(calls).toEqual(['gather', 'craft'])
  expect(includes).toEqual(Array.from({ length: 2 }, () => ({ effects: true, events: true, objectTypes: true })))
  expect(chain.calls.executions).toBe(2)
  expect(chain.calls.simulations).toBeGreaterThanOrEqual(2)
  await f.runtime.stop()
})
