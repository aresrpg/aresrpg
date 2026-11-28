// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Professions: gathering and crafting choices, real SDK PTBs, and receipt-proven reconciliation.
import { expect, test, describe } from 'bun:test'
import { gatherable_catalog, job_slugs, job_xp_for_level } from '@aresrpg/immutable'
import { worlds_source } from '@aresrpg/engine/data'
import { SDK, type SuiTransport } from '@aresrpg/sdk'
import { Transaction } from '@mysten/sui/transactions'
import { create_agent_multisig } from '@aresrpg/sdk/agent-multisig'
import { create_agent_transaction_signer } from '@aresrpg/sdk/agent-transactions'
import { ZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { fromBase64 } from '@mysten/sui/utils'
import { recipe_id, item_template_id } from '@aresrpg/sdk/seed-ids'
import type { Receipt } from '@aresrpg/sdk/cache'

import { select_profession } from '../src/behavior_profession.ts'
import { execute_gameplay } from '../src/gameplay.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import items from '../../../seed/content/items.json'
import { fake_client, pins, id, digest } from '../../sdk/test/helpers/transport.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { create_transaction_lifecycle } from '../src/transaction_lifecycle.ts'
import { run_tick } from '../src/run_runtime.ts'
import { bind_action_baseline, reconcile_action, action_projected } from '../src/action_reconciliation.ts'
import type { ProvisionRequest } from '../src/provisioning.ts'

import { fixture_script } from './fixture_fight.ts'
import { profession_context, character, item, recipe, resource, other_input, plan_of } from './fixture_game.ts'
import { runtime_fixture } from './fixture.ts'

describe('behavior profession', () => {
  const action = { type: 'profession', character_id: character.id, world: 'fixture', order: 'best_progress' } as const

  test('profession chooses actual feasible XP craft, reevaluates inventory and does not swallow craft races', () => {
    const context = profession_context()
    const ready = {
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: {
          ...context.snapshot.inventory!,
          items: Object.entries(recipe.inputs).map(([type, amount], index) => item(type, amount, 30 + index)),
        },
      },
    }
    const selected = select_profession(action, ready)
    expect(selected).toMatchObject({ status: 'action', action: { kind: 'craft' } })
    if (selected.status !== 'action') throw new Error('expected craft')
    expect(plan_of({ ...ready, command: { ...ready.command, ...selected.action } }).kind).toBe('craft')
    expect(() => plan_of({ ...context, command: { ...context.command, ...selected.action } })).toThrow(
      'ingredients_required'
    )
    expect(select_profession(action, context)).toMatchObject({ status: 'action', action: { kind: 'gather' } })
    expect(() =>
      select_profession(action, {
        ...ready,
        snapshot: { ...ready.snapshot, inventory: { ...ready.snapshot.inventory, trades: null } },
      })
    ).toThrow('inventory_unavailable')
  })

  test('every gathering job selects its available tool, then harvests after equipment observation; absent tool blocks exploration', () => {
    for (const job of ['FARMER', 'HERBALIST', 'MINER']) {
      const context = profession_context()
      const resource = gatherable_catalog.find((row) => row.job === job && row.tier === 1)!
      const source = items.find((row) => row.category === `tool_${job.toLowerCase()}` && row.level <= character.level)!
      const tool = { ...item(source.item_type, 1), category: source.category, level: source.level }
      const zone = context.snapshot.zones['fixture:97:97']!
      const ready = {
        ...context,
        snapshot: {
          ...context.snapshot,
          characters: [{ ...character, equipment: [] }],
          inventory: { ...context.snapshot.inventory!, items: [tool] },
          zones: {
            'fixture:97:97': {
              ...zone,
              spawns: {
                ...zone.spawns!,
                resources: [{ index: 0, x: character.x!, z: character.z!, item_type: resource.item_type, nodes: 2 }],
              },
            },
          },
        },
      }
      const equip = select_profession(action, ready)
      expect(equip).toMatchObject({
        status: 'action',
        action: { kind: 'equip_item', payload: { item_id: tool.id, slot: 'tool' } },
      })
      if (equip.status !== 'action') throw new Error('expected equip')
      expect(plan_of({ ...ready, command: { ...ready.command, ...equip.action } }).kind).toBe('equip_item')
      const equipped = {
        ...ready,
        snapshot: {
          ...ready.snapshot,
          characters: [{ ...character, equipment: [{ ...tool, slot: 'tool' }] }],
          inventory: { ...ready.snapshot.inventory, items: [] },
        },
      }
      const gather = select_profession(action, equipped)
      expect(gather).toMatchObject({
        status: 'action',
        action: { kind: 'gather', payload: { item_type: resource.item_type } },
      })
      if (gather.status !== 'action') throw new Error('expected gather')
      const harvest = (held: readonly ReturnType<typeof item>[]) =>
        plan_of({
          ...equipped,
          snapshot: { ...equipped.snapshot, inventory: { ...equipped.snapshot.inventory, items: held } },
          command: { ...equipped.command, ...gather.action },
        })
      expect(harvest([])).toMatchObject({ kind: 'gather', input: { existing: null } })
      // A harvest adds to the largest pile the hero holds: a pile per harvest fills the bag with objects.
      const piles = [item(resource.item_type, 1, 40), item(resource.item_type, 7, 41), item('other', 9, 42)]
      expect(harvest(piles)).toMatchObject({ kind: 'gather', input: { existing: piles[1]!.id } })
      expect(() =>
        select_profession(action, {
          ...ready,
          snapshot: { ...ready.snapshot, inventory: { ...ready.snapshot.inventory, items: [] } },
        })
      ).toThrow('tool_unavailable')
    }
  })

  test('selected strategy goes from exhausted patches to onward discovery and never falls through an uncertain inventory', () => {
    const context = profession_context()
    const { world } = worlds_source[0]!
    const zone = context.snapshot.zones['fixture:97:97']!
    const snapshot = {
      ...context.snapshot,
      characters: [{ ...character, world, checkpoint_world: world }],
      zones: {
        [`${world}:97:97`]: {
          ...zone,
          zone: { ...zone.zone, world, res_taken: [20] },
          spawns: { ...zone.spawns!, world, resources: [] },
        },
      },
      tracked_zones: {
        [character.id]: {
          ...context.snapshot.tracked_zones[character.id]!,
          world,
          zones: [
            { zx: 97, zz: 97 },
            { zx: 96, zz: 97 },
          ],
        },
      },
    }
    const run: BehaviorRun = {
      id: 'run',
      bot_id: 'bot',
      grant_id: 'grant',
      lane_key: 'lane',
      character_id: context.snapshot.characters[0]!.id,
      fingerprint: 'fixture',
      script: parse_behavior_script(fixture_script({ character: character.id, world, jobs: job_slugs })),
      revision: 1,
      memory: empty_behavior_memory(),
      pending_node: null,
      activation: null,
      consumed_command_id: null,
      status: 'active',
      actions_started: 0,
      last_command_id: null,
      created_at: 0,
    }
    expect(next_behavior_action(run, null, { ...context, snapshot })).toMatchObject({
      state: 'action',
      action: { kind: 'world_search', payload: { world, x: 49408 } },
    })
    expect(
      next_behavior_action(run, null, {
        ...context,
        snapshot: { ...snapshot, inventory: { ...snapshot.inventory!, loaded: false } },
      })
    ).toMatchObject({ state: 'waiting', issue: 'inventory_unavailable', action: undefined })
    const leveled = {
      ...context,
      snapshot: {
        ...context.snapshot,
        characters: [{ ...character, jobs: { [resource.job]: String(job_xp_for_level(100)) } }],
        inventory: { ...context.snapshot.inventory!, items: [item(other_input, 100)] },
      },
    }
    expect(select_profession(action, leveled).status).toBe('action')
  })
})

describe('profession', () => {
  test('craft uses one canonical stack plan, excludes listings and rejects stale revisions', () => {
    const context = profession_context()
    const inputs = Object.entries(recipe.inputs).map(([item_type, amount], index) =>
      item(item_type, amount, 30 + index)
    )
    const snapshot = { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items: inputs } }
    const payload = { character_id: character.id, output_type: recipe.output_type, attempts: 1 }
    const action = { kind: 'craft' as const, payload }
    const validated = plan_of({ ...context, snapshot, command: { ...context.command, ...action } })
    expect(validated.kind).toBe('craft')
    if (validated.kind === 'craft') expect(validated.input.input_item_ids).toEqual(inputs.map(({ id }) => id))
    expect(validated).toMatchObject({ input: { existing: null } })
    const made = item(recipe.output_type, 3, 50)
    const holding = { ...snapshot, inventory: { ...snapshot.inventory, items: [...inputs, made] } }
    expect(plan_of({ ...context, snapshot: holding, command: { ...context.command, ...action } })).toMatchObject({
      input: { existing: made.id },
    })
    expect(() =>
      plan_of({
        ...context,
        snapshot: { ...snapshot, observation_revision: 2 },
        command: { ...context.command, ...action },
      })
    ).toThrow('needs_resync')
    const listed = { ...snapshot, inventory: { ...snapshot.inventory, listings: [{ id: inputs[0]!.id }] as never } }
    expect(() => plan_of({ ...context, snapshot: listed, command: { ...context.command, ...action } })).toThrow(
      'ingredients_required'
    )
  })
})

describe('profession sdk', () => {
  test('a hero tree reaches real SDK gather and craft PTBs through the session lifecycle using only fixture transport', async () => {
    const f = await runtime_fixture()
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const lease = await control.acquire(f.bot, 'actor', 10000)
    const lane_key = lane_key_for(f.bot)
    await control.observed(lane_key, 'actor', lease.fence, true)
    const started = await control.start_behavior(f.grant, {
      idempotency_key: 'gather-craft',
      decision_revision: 0,
      observation_revision: 1,
      script: {
        version: '1',
        objective: { title: 'Gather, then craft' },
        tree: {
          type: 'sequence',
          children: [
            {
              type: 'action',
              action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
            },
            {
              type: 'action',
              action: {
                type: 'call',
                kind: 'craft',
                payload: { character_id: character.id, output_type: recipe.output_type, attempts: 1 },
              },
            },
            { type: 'complete' },
          ],
        },
      },
    })
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
      const run = (await f.store.read<BehaviorRun>(`behavior:${started.id}`))!
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
      // The previous signature's effect must be observed before the tree advances.
      await reconcile_action(f.store, lane_key, 'actor', lease.fence, context, f.clock.now)
      await run_tick({
        store: f.store,
        config: f.options.config,
        run,
        actor_id: 'actor',
        fence: lease.fence,
        context,
        now: f.clock.now,
      })
      const admitted = (await f.store.read<BehaviorRun>(`behavior:${run.id}`))!
      expect(admitted.actions_started).toBe(revision)
      const command = bind_action_baseline(
        (await f.store.read<Command>(`command:${admitted.last_command_id}`))!,
        context
      )
      const journal = create_transaction_lifecycle(
        f.store,
        f.options.config,
        () => ({ command, actor_id: 'actor', fence: lease.fence }),
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
})

describe('action reconciliation', () => {
  test('settlement waits for receipt-proven loot inventory; certified zero-loot settlement also completes', () => {
    const context = profession_context()
    const loot = { ...item(resource.item_type, 2, 99), version: '9' }
    const command = {
      ...context.command,
      kind: 'fight_settle' as const,
      status: 'completed' as const,
      payload: { character_id: character.id, fight: 'old' },
      result: { digest: 'receipt' },
      action_baseline: { checkpoint_ms: 0 },
    }
    const receipt = {
      Transaction: {
        digest: 'receipt',
        effects: { lamportVersion: '9', changedObjects: [{ objectId: loot.id, outputVersion: '9' }] },
        objectTypes: { [loot.id]: 'fixture::item::Item' },
        events: [{ type: 'fixture::item::AmountChanged', json: { item: loot.id, amount: 2 } }],
      },
    }
    expect(action_projected(command, receipt, context)).toBe(false)
    const projected = (version: string) => ({
      ...context,
      snapshot: {
        ...context.snapshot,
        inventory: {
          ...context.snapshot.inventory!,
          items: [...context.snapshot.inventory!.items, { ...loot, version }],
        },
      },
    })
    expect(action_projected(command, receipt, projected('8'))).toBe(false)
    expect(action_projected(command, receipt, projected('9'))).toBe(true)
    const no_loot = {
      Transaction: {
        digest: 'receipt',
        effects: { lamportVersion: '9', changedObjects: [] },
        objectTypes: {},
        events: [],
      },
    }
    expect(action_projected(command, no_loot, context)).toBe(true)
  })

  // A settled hero creation, withdrawal or collection names no hero. Before this rule each one left the
  // wallet waiting for a resync that never came, so the bot could not sign again.
  const id = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`
  const settled_receipt = (events: unknown[] = []): Receipt => ({
    Transaction: {
      digest: 'settled',
      effects: { status: { success: true }, lamportVersion: '9', changedObjects: [] },
      events,
    },
  })
  const settled = (kind: Command['kind'], payload: Record<string, unknown>): Command => ({
    ...profession_context().command,
    kind,
    payload,
    status: 'completed',
    result: { digest: 'settled' },
    action_baseline: { checkpoint_ms: 0 },
  })
  test('wallet-level commands reconcile without a hero', () => {
    const context = profession_context()
    const listing = { id: id(40), kiosk: character.kiosk } as never
    const listed = {
      ...context,
      snapshot: { ...context.snapshot, inventory: { ...context.snapshot.inventory!, listings: [listing] } },
    }
    expect(action_projected(settled('market_collect', {}), settled_receipt(), context)).toBe(true)
    const delist = settled('market_delist', { item_id: id(40), kiosk: character.kiosk })
    expect(action_projected(delist, settled_receipt(), listed)).toBe(false)
    expect(action_projected(delist, settled_receipt(), context)).toBe(true)
    const created = settled_receipt([{ type: `${id(1)}::character::CharacterCreated`, json: { character: id(77) } }])
    const create = settled('create_character', { name: 'newhero' })
    expect(action_projected(create, created, context)).toBe(false)
    const born = {
      ...context,
      snapshot: { ...context.snapshot, characters: [character, { ...character, id: id(77) }] },
    }
    expect(action_projected(create, created, born)).toBe(true)
  })
})
