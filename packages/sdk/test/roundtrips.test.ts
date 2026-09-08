// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { SDK } from '../src/client.ts'
import { character_actions } from '../src/character_actions.ts'
import { fight_actions } from '../src/fight.ts'
import { item_template_id, recipe_id } from '../src/seed_ids.ts'

import { digest, fake_client, id, pins, signer } from './helpers/transport.ts'

const personal = { objectId: id(13), kioskId: id(12), isPersonal: true, version: '1', digest }
const custody = { kiosk: personal.kioskId, kiosk_cap: personal.objectId }
const cap_loader = async () => personal
const fight = id(70)

const session_pins = {
  ...pins,
  package_original: pins.package,
  seed_package_original: id(60),
  content_root: { id: id(61), shared_version: '1' },
}

const intents = [
  {
    name: 'craft batch',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      character_actions(sdk, { kiosk_cap: cap_loader }).craft({
        character_id: id(20),
        output_type: 'wheat_flour',
        input_item_ids: [id(21), id(22)],
        existing: null,
        attempts: 10,
        custody,
      }),
    commands: ['craft'],
    events: [
      {
        type: `${pins.package}::crafting::Crafted`,
        json: {
          recipe: recipe_id(session_pins.content_root.id, session_pins.seed_package_original, 'wheat_flour'),
          character: id(20),
          output_template: item_template_id(
            session_pins.content_root.id,
            session_pins.seed_package_original,
            'wheat_flour'
          ),
          attempts: 10,
          successes: 7,
          job_xp_gained: 70,
        },
      },
    ],
  },
  {
    name: 'rune scribing',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      character_actions(sdk, { kiosk_cap: cap_loader }).scribe_rune({
        character_id: id(20),
        gear_id: id(21),
        gear_item_type: 'straw_hat',
        rune_item_id: id(22),
        rune_item_type: 'rune_vitality_ba',
        custody,
      }),
    commands: ['scribe_rune'],
    events: [
      {
        type: `${pins.package}::forgemagie::RuneScribed`,
        json: {
          stat: 0,
          outcome: 1,
          applied_value: 3,
          lost_amounts: Array.from({ length: 15 }, (_, index) => (index === 4 ? 2 : 0)),
          new_puits: '7',
        },
      },
    ],
  },
  {
    name: 'drafted turn with repeated spell',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      fight_actions(sdk, { kiosk_cap: cap_loader }).commit_turn({
        fight,
        actions: [
          { type: 'move', path: [1n, 2n] },
          { type: 'cast', spell: 'slash', fighter_idx: 0n, target_cell: 3n },
          { type: 'cast', spell: 'slash', fighter_idx: 0n, target_cell: 3n },
        ],
      }),
    commands: ['move_fighter', 'cast_spell', 'cast_spell', 'end_fight_turn'],
  },
  {
    name: 'ready all',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      fight_actions(sdk, { kiosk_cap: cap_loader }).ready_many({
        fight,
        fighter_indices: [0n, 1n, 1n],
      }),
    commands: ['ready_fight', 'ready_and_start_fight'],
  },
  {
    name: 'same-kiosk settlement',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      fight_actions(sdk, { kiosk_cap: cap_loader }).settle({
        fight,
        custody,
        last: true,
        settlements: [0n, 1n].map((fighter_idx) => ({ fighter_idx, loot: [{ item_type: 'fang', existing: null }] })),
      }),
    commands: ['prepare_fight_loot', 'prepare_fight_loot', 'settle_last_fight'],
  },
  {
    name: 'zone discovery',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      character_actions(sdk, { kiosk_cap: cap_loader }).search_zone({
        character_id: id(20),
        world: 'nauvis',
        x: 50_000,
        z: 50_000,
        refresh: false,
        custody,
      }),
    commands: ['create_zone'],
  },
  {
    name: 'loot claim',
    invoke: (sdk: ReturnType<typeof SDK>) =>
      character_actions(sdk, { kiosk_cap: cap_loader }).claim_loot({
        claim_id: id(80),
        rolled_item_type: 'fang',
        existing: null,
        custody,
      }),
    commands: ['claim_loot'],
  },
] as const

const session = (client: ReturnType<typeof fake_client>) => {
  const transactions: (readonly string[])[] = []
  const sdk = SDK({
    client,
    address: signer.toSuiAddress(),
    pins: session_pins,
    sign_transaction: async (tx) => {
      transactions.push(
        tx.getData().commands.flatMap((command) => (command.MoveCall ? [command.MoveCall.function] : []))
      )
      return tx.sign({ signer })
    },
  })
  return { sdk, transactions }
}

for (const intent of intents)
  test(`${intent.name}: one cold read, zero warm reads, one submission`, async () => {
    const client = fake_client({ simulate_ok: true, events: 'events' in intent ? intent.events : [] })
    const { sdk, transactions } = session(client)
    await intent.invoke(sdk)
    expect(transactions).toEqual([intent.commands])
    expect(client.calls.hydrations).toHaveLength(1)
    expect(new Set(client.calls.hydrations[0]).size).toBe(client.calls.hydrations[0]!.length)
    expect(client.calls).toMatchObject({ resolutions: 1, simulations: 1, executions: 1, visibility_waits: [] })

    // Repeating the input here measures a warm SDK, not permission to replay a real action.
    await intent.invoke(sdk)
    expect(transactions).toEqual([intent.commands, intent.commands])
    expect(client.calls.hydrations).toHaveLength(1)
    expect(client.calls).toMatchObject({ resolutions: 2, simulations: 2, executions: 2 })
    expect(client.calls.visibility_waits).toEqual([client.calls.digests[0]!])
  })

for (const intent of intents)
  test(`${intent.name}: refusal never signs; executed failure never retries`, async () => {
    for (const simulate_ok of [false, true]) {
      const client = fake_client({ simulate_ok, execution_ok: false })
      const { sdk, transactions } = session(client)
      await expect(intent.invoke(sdk)).rejects.toThrow(simulate_ok ? 'failed on-chain' : 'NOT submitted')
      expect(transactions).toHaveLength(simulate_ok ? 1 : 0)
      expect(client.calls).toMatchObject({ resolutions: 1, simulations: 1, executions: simulate_ok ? 1 : 0 })
    }
  })
