// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character builder's receipt law: exact capital spending reaches character.move unchanged,
// so SDK composition never invents natural stat gains.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'
import { character_create } from '../src/character.ts'
import { character_actions as gate_actions } from '../src/character_actions.ts'
import { fight_actions } from '../src/fight.ts'
import { item_template_id, recipe_id, world_content_id, world_id } from '../src/seed_ids.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'

const resolve_inputs: TransactionPlugin = async (transaction_data, options, next) => {
  transaction_data.inputs.forEach((input, index) => {
    const unresolved = (input as { UnresolvedObject?: { objectId: string } }).UnresolvedObject
    if (!unresolved) return
    transaction_data.inputs[index] = {
      $kind: 'Object',
      Object: {
        $kind: 'SharedObject',
        SharedObject: { objectId: unresolved.objectId, initialSharedVersion: '1', mutable: true },
      },
    } as never
  })
  if (!options.onlyTransactionKind) {
    transaction_data.gasData.price ??= '1000'
    transaction_data.gasData.budget ??= '5000000'
    transaction_data.gasData.payment ??= [{ objectId: id(50), version: '3', digest }]
  }
  await next()
}

const fake_client = (receipt: () => Receipt) => ({
  core: {
    resolveTransactionPlugin: () => resolve_inputs,
    getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
      objects: objectIds.map((object_id) => ({
        objectId: object_id,
        version: '1',
        digest,
        owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
      })),
    }),
    simulateTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
    executeTransaction: async (): Promise<Receipt> => receipt(),
  },
})

const pins = {
  package: id(1),
  package_original: id(1),
  seed_package: id(60),
  seed_package_original: id(60),
  content_root: { id: id(61), shared_version: '1' },
  version: { id: id(6), shared_version: '1' },
  name_registry: { id: id(4), shared_version: '1' },
  character_policy: { id: id(5), shared_version: '1' },
  character_protected_policy: { id: id(11), shared_version: '1' },
}

const kiosk_cap = { objectId: id(3), kioskId: id(12), isPersonal: true } as KioskOwnerCap

/** A TERMINAL (&Random) door's harness: those doors take the PACKED personal cap and compose
 *  with no borrow bracket, so the fake exposes exactly that shape. */
const terminal_sdk = (doors: Record<string, unknown>, events: readonly unknown[] = []) => ({
  tx: () => ({}),
  execute: async () => ({ $kind: 'Transaction', Transaction: { digest, events } }) as unknown as Receipt,
  hydrate: async () => {},
  hydrate_unknown: async () => {},
  // every content and gameplay world id derives from the living Registry root
  pins: {
    ...pins,
    template_registry: { id: id(7), shared_version: '1' },
    seed_package: id(60),
    seed_package_original: id(60),
    content_root: { id: id(61), shared_version: '1' },
  },
  // a derived id names its type by the DEFINING package — never pins.package
  game_type_package: id(1),
  doors,
})

const game = (receipt: () => Receipt = () => ({ $kind: 'Transaction', Transaction: { digest } })) => {
  const sdk = SDK({ client: fake_client(receipt) as unknown as SuiTransport, signer: new Ed25519Keypair(), pins })
  absorb_receipt(sdk.cache, {
    effects: {
      changedObjects: [
        {
          objectId: id(20),
          idOperation: 'Created',
          outputState: 'ObjectWrite',
          outputVersion: '1',
          outputDigest: digest,
          outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        },
      ],
    },
  })
  return sdk
}

describe('the character builder', () => {
  test('every action can resolve the exact projected kiosk instead of an implicit first cap', async () => {
    let requested: string | undefined
    const raised: Record<string, unknown>[] = []
    const sdk = {
      tx: () => ({}),
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
        compose('projected_kiosk', {}),
      execute: async () => ({ $kind: 'Transaction', Transaction: { digest } }) as unknown as Receipt,
      doors: { raise_stat: (_tx: unknown, args: Record<string, unknown>) => raised.push(args) },
    }
    const actions = gate_actions(sdk as never, {
      kiosk_cap: async (kiosk) => {
        requested = kiosk
        return kiosk_cap
      },
    })
    await actions.raise_stats({
      character_id: id(20),
      spending: { strength: 2 },
      custody: { kiosk: id(99) },
    })
    expect(requested).toBe(id(99))
    expect(raised).toEqual([expect.objectContaining({ character_id: id(20), stat: 'strength', points: 2 })])
  })

  test('create refuses to invent the character id when the receipt carries no CharacterCreated', async () => {
    const sdk = game()
    await expect(
      character_create(
        sdk as never,
        {
          name: 'aiden',
          classe: 'senshi',
          male: true,
          color_1: 1,
          color_2: 2,
          color_3: 3,
          kiosk_cap,
        },
        'nauvis'
      )
    ).rejects.toThrow('CharacterCreated')
  })

  test('create validates before building and passes only the normalized name to the Move door', async () => {
    let tx_calls = 0
    let raw_name = ''
    const sdk = {
      tx: () => {
        tx_calls += 1
        return {}
      },
      with_personal_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: unknown, cap: unknown) => void) =>
        compose({}, {}),
      coin_of: () => ({}),
      doors: {
        create_character: (_tx: unknown, input: Readonly<{ raw_name: string }>) => {
          ;({ raw_name } = input)
        },
      },
      execute_personal_kiosk: async () => ({ receipt: {}, kiosk_cap }),
      pins: { content_root: { id: id(1) }, seed_package_original: id(2) },
      hydrate_unknown: async () => undefined,
    }
    const input = {
      name: 'Sceat 6',
      classe: 'senshi',
      male: true,
      color_1: 1,
      color_2: 2,
      color_3: 3,
      kiosk_cap,
    }

    await expect(character_create(sdk as never, input, 'nauvis')).rejects.toThrow('4–19')
    expect(tx_calls).toBe(0)
    await expect(character_create(sdk as never, { ...input, name: ' AiDeN ' }, 'nauvis')).rejects.toThrow(
      'CharacterCreated'
    )
    expect(raw_name).toBe('aiden')
  })

  test('join_world composes one custody door and folds the receipt own WorldJoined', async () => {
    let door_args: Record<string, unknown> | null = null
    const receipt = {
      $kind: 'Transaction',
      Transaction: {
        digest,
        events: [
          {
            type: `${id(1)}::world::WorldJoined`,
            json: { character: id(20), world: 'yakutia', x: 50000, z: 50000, first_join: false },
          },
        ],
      },
    } as unknown as Receipt
    const sdk = {
      tx: () => ({}),
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
        compose('kiosk_id', {}),
      execute: async () => receipt,
      hydrate_unknown: async () => {},
      pins,
      doors: {
        join_world: (_tx: unknown, args: Record<string, unknown>) => {
          door_args = args
        },
      },
    }
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })
    const out = await actions.join_world({ character_id: id(20), world: 'yakutia' })
    expect(door_args).toMatchObject({
      kiosk: 'kiosk_id',
      character_id: id(20),
      destination: world_content_id(id(61), id(60), 'yakutia'),
    })
    expect(out.joined).toEqual({ world: 'yakutia', x: 50000, z: 50000, first_join: false })
  })

  test('seed-derived ids name their type by the DEFINING package, never the upgraded one', async () => {
    // 2026-08-22: engaging a mob failed with "[sdk] unresolved object 0x34a2…". A derived id is
    // computed from a TYPE TAG, and on Sui a type is named by its FIRST-publish address forever
    // — `pins.package` follows the latest upgrade and is a move-call target only. After the game
    // package was upgraded, every content id (mob, spell, recipe, sale…) pointed at nothing.
    const upgraded = id(90)
    const defining = id(91)
    const root = id(7)
    const sdk = {
      tx: () => ({}),
      execute: async () => ({ $kind: 'Transaction', Transaction: { digest } }) as unknown as Receipt,
      hydrate_unknown: async () => {},
      // living content: the derivation anchors on the seed package's ORIGINAL id — the
      // upgraded id must never leak into an address
      pins: {
        ...pins,
        seed_package: upgraded,
        seed_package_original: defining,
        content_root: { id: root, shared_version: '1' },
      },
      game_type_package: defining,
      doors: {},
    }

    // spell_template_id derives off the type package — the same helper every content id uses
    const { spell_template_id } = await import('../src/seed_ids.ts')
    let seen: string | null = null
    const spy = {
      ...sdk,
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
        compose('kiosk_id', {}),
      doors: { raise_spell: (_tx: unknown, args: Record<string, unknown>) => void (seen = args.spell as string) },
    }
    await gate_actions(spy as never, { kiosk_cap: async () => kiosk_cap }).raise_spell({
      character_id: id(20),
      spell: 'Cleaving Strike',
    })

    expect(seen as string | null).toBe(spell_template_id(root, defining, 'Cleaving Strike'))
    expect(seen as string | null).not.toBe(spell_template_id(root, upgraded, 'Cleaving Strike'))
  })

  test('scribe_rune composes the terminal door and returns only the RuneScribed receipt truth', async () => {
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk(
      { scribe_rune: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) },
      [
        {
          type: `${id(1)}::forgemagie::RuneScribed`,
          json: { stat: 0, outcome: 1, applied_value: 3, lost_stat: 4, lost_amount: 2, new_puits: 7 },
        },
      ]
    )
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    const outcome = await actions.scribe_rune({
      character_id: id(20),
      gear_id: id(21),
      gear_item_type: 'straw_hat',
      rune_item_id: id(22),
      custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    })

    expect(door_args).toMatchObject({
      kiosk: kiosk_cap.kioskId,
      personal: kiosk_cap.objectId,
      character_id: id(20),
      gear_id: id(21),
      gear_template: item_template_id(id(61), id(60), 'straw_hat'),
      rune_item_id: id(22),
    })
    expect(outcome).toMatchObject({
      stat: 0,
      outcome: 1,
      applied_value: 3,
      lost_stat: 4,
      lost_amount: 2,
      new_puits: 7,
    })
  })

  test('craft composes one terminal batch and projects its aggregate receipt', async () => {
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk({ craft: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) }, [
      {
        type: `${id(1)}::crafting::Crafted`,
        json: {
          recipe: recipe_id(id(61), id(60), 'wheat_flour'),
          character: id(20),
          crafter: id(70),
          output_template: item_template_id(id(61), id(60), 'wheat_flour'),
          attempts: 100,
          successes: 63,
          job_xp_gained: '2500',
        },
      },
    ])
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    const outcome = await actions.craft({
      character_id: id(20),
      output_type: 'wheat_flour',
      input_item_ids: [id(31), id(32)],
      existing: id(33),
      attempts: 100,
      custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    })

    expect(door_args).toMatchObject({
      kiosk: kiosk_cap.kioskId,
      personal: kiosk_cap.objectId,
      character_id: id(20),
      recipe: recipe_id(id(61), id(60), 'wheat_flour'),
      output_template: item_template_id(id(61), id(60), 'wheat_flour'),
      input_item_ids: [id(31), id(32)],
      existing: id(33),
      attempts: 100,
    })
    expect(outcome).toMatchObject({ attempts: 100, successes: 63, job_xp_gained: 2500 })
  })

  test('craft refuses a batch above the global cap before signing', async () => {
    const actions = gate_actions(terminal_sdk({}) as never, { kiosk_cap: async () => kiosk_cap })
    await expect(
      actions.craft({
        character_id: id(20),
        output_type: 'wheat_flour',
        input_item_ids: [id(31), id(32)],
        existing: null,
        attempts: 1_001,
      })
    ).rejects.toThrow('1 to 1000')
  })

  test('a world door receives the World OBJECT, never the world NAME', async () => {
    // 2026-08-22: pressing G failed with "invalid object_id: Unable to parse Address (must be hex
    // string of length 32)". `api::search_zone` takes `&mut World` — an OBJECT — while the app
    // knows a world by its authored name; passing the name straight through handed Sui a
    // non-address. The SDK derives the object from the Registry root and core type package.
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk({ search_zone: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) })
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    await actions.search_zone({ character_id: id(20), world: 'nauvis', x: 1, z: 2 })

    expect(door_args!.w).toBe(world_id(id(61), id(1), 'nauvis'))
  })

  test('a world whose derived object does not exist fails during explicit hydration', async () => {
    const sdk = {
      ...terminal_sdk({ search_zone: () => {} }),
      hydrate_unknown: async () => {
        throw new Error('unknown world 99_nowhere')
      },
    }
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    await expect(actions.search_zone({ character_id: id(20), world: '99_nowhere', x: 1, z: 2 })).rejects.toThrow(
      '99_nowhere'
    )
  })

  test('search_zone proves the walk with the pose it was given and folds NOTHING', async () => {
    // the search's whole output is zone state — a seed read off this receipt would race the
    // projected row that carries it, so the client waits for the stream instead
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk({ search_zone: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) })
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    const out = await actions.search_zone({ character_id: id(20), world: 'nauvis', x: 49_700, z: 50_200 })

    expect(door_args).toMatchObject({
      kiosk: kiosk_cap.kioskId,
      personal: kiosk_cap.objectId,
      character_id: id(20),
      x: 49_700,
      z: 50_200,
      w: world_id(id(61), id(1), 'nauvis'),
    })
    expect(out).toEqual({ digest })
  })

  test('gather passes the row own rare link, and reports the protector verdict it drew', async () => {
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk({ gather: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) }, [
      { type: `${id(1)}::gathering::ResourceGathered`, json: { quantity: '3', protector: true } },
    ])
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    const out = await actions.gather({
      character_id: id(20),
      world: '01_first_shore',
      zx: 97,
      zz: 98,
      pack_index: 4,
      item_type: 'green_mushroom',
      rare_item_type: 'arcaneshroom',
      existing: null,
      existing_rare: null,
    })

    expect(door_args).toMatchObject({ zx: 97, zz: 98, pack_index: 4, existing: null })
    expect(door_args!.template).not.toBe(door_args!.rare_template)
    // a fired verdict ROOTS the character until resolve_ambush — the caller must learn it here
    expect(out).toEqual({ digest, quantity: 3, ambushed: true })
  })

  test('a resource row with no rare link gathers against its own template twice', async () => {
    // gathering.move own convention: the base template stands in for the absent rare, and it
    // asserts the identity before any draw — passing a different item would abort
    let door_args: Record<string, unknown> | null = null
    const sdk = terminal_sdk({ gather: (_tx: unknown, args: Record<string, unknown>) => void (door_args = args) }, [
      { type: `${id(1)}::gathering::ResourceGathered`, json: { quantity: '1', protector: false } },
    ])
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    const out = await actions.gather({
      character_id: id(20),
      world: '01_first_shore',
      zx: 97,
      zz: 98,
      pack_index: 0,
      item_type: 'wheat',
      rare_item_type: null,
      existing: null,
      existing_rare: null,
    })

    expect(door_args!.template).toBe(door_args!.rare_template)
    expect(out.ambushed).toBe(false)
  })

  test('protector resolution returns the created fight id from its own receipt', async () => {
    const fight = id(30)
    const sdk = {
      ...terminal_sdk({ resolve_ambush: () => {} }, [{ type: `${id(1)}::fight::FightCreated`, json: { fight } }]),
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, owner_cap: unknown) => void) =>
        compose(id(12), {}),
    }
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    await expect(
      actions.resolve_ambush({ character_id: id(20), protector_mob_type: 'protector_wheat_bricheton' })
    ).resolves.toEqual({ digest, fight })
  })

  test('gather refuses to invent an outcome when the receipt carries no ResourceGathered', async () => {
    const sdk = terminal_sdk({ gather: () => {} })
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })

    await expect(
      actions.gather({
        character_id: id(20),
        world: '01_first_shore',
        zx: 97,
        zz: 98,
        pack_index: 0,
        item_type: 'wheat',
        rare_item_type: null,
        existing: null,
        existing_rare: null,
      })
    ).rejects.toThrow('ResourceGathered')
  })

  test('join_world refuses to invent the arrival when the receipt carries no WorldJoined', async () => {
    const sdk = {
      tx: () => ({}),
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: unknown) => void) =>
        compose('kiosk_id', {}),
      execute: async () => ({ $kind: 'Transaction', Transaction: { digest } }) as unknown as Receipt,
      hydrate_unknown: async () => {},
      pins,
      doors: { join_world: () => {} },
    }
    const actions = gate_actions(sdk as never, { kiosk_cap: async () => kiosk_cap })
    await expect(actions.join_world({ character_id: id(20), world: 'yakutia' })).rejects.toThrow('WorldJoined')
  })

  test('fight settlement prepares every loot type and collects all of them in one transaction without polling', async () => {
    const calls: { door: string; args: Record<string, unknown> }[] = []
    const hydrated: string[][] = []
    let executions = 0
    const sdk = {
      ...terminal_sdk({
        prepare_fight_loot: (_tx: unknown, input: Record<string, unknown>) => {
          calls.push({ door: 'prepare', args: input })
          return `prepared-${calls.length}`
        },
        settle_fight: (_tx: unknown, input: Record<string, unknown>) =>
          void calls.push({ door: 'settle', args: input }),
        settle_last_fight: (_tx: unknown, input: Record<string, unknown>) =>
          void calls.push({ door: 'settle_last', args: input }),
      }),
      hydrate_unknown: async (ids: readonly string[]) => void hydrated.push([...ids]),
      execute: async () => {
        executions += 1
        return {
          $kind: 'Transaction',
          Transaction: {
            digest,
            events: [
              { type: `${id(1)}::fight::FightClosable`, json: { fight: id(40) } },
              { type: `${id(1)}::fight::FightClosed`, json: { fight: id(40) } },
            ],
          },
        } as unknown as Receipt
      },
    }
    const result = await fight_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).settle({
      fight: id(40),
      fighter_idx: 2n,
      loot: [
        { item_type: 'silk', existing: id(41) },
        { item_type: 'fang', existing: null },
        { item_type: 'silk', existing: id(41) },
      ],
      custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    })
    expect(executions).toBe(1)
    expect(calls.map(({ door }) => door)).toEqual(['prepare', 'prepare', 'settle_last'])
    expect(calls[2]?.args).toMatchObject({
      f: id(40),
      fighter_idx: 2n,
      plan: ['prepared-1', 'prepared-2'],
      kiosk: kiosk_cap.kioskId,
      personal: kiosk_cap.objectId,
    })
    expect(hydrated).toHaveLength(2)
    expect(result.closable).toBeTrue()
    expect(result.closed).toBeTrue()
    expect(sdk).not.toHaveProperty('hydrate_owned_current')
  })

  test('a non-final settlement falls back only after the atomic probe is refused before signing', async () => {
    const calls: string[] = []
    let executions = 0
    const sdk = {
      ...terminal_sdk({
        prepare_fight_loot: () => 'prepared',
        settle_last_fight: () => void calls.push('last'),
        settle_fight: () => void calls.push('ordinary'),
      }),
      execute: async () => {
        executions += 1
        if (executions === 1)
          throw new Error("Transaction resolution failed: MoveAbort abort code: 1729 in '0x1::fight::settle_last'")
        return { $kind: 'Transaction', Transaction: { digest, events: [] } } as unknown as Receipt
      },
    }
    const result = await fight_actions(sdk as never, { kiosk_cap: async () => kiosk_cap }).settle({
      fight: id(40),
      fighter_idx: 0n,
      loot: [{ item_type: 'silk', existing: null }],
      custody: { kiosk: kiosk_cap.kioskId, kiosk_cap: kiosk_cap.objectId },
    })

    expect(calls).toEqual(['last', 'ordinary'])
    expect(executions).toBe(2)
    expect(result).toMatchObject({ digest, closed: false })
  })
})
