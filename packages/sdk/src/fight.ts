// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight builder — the app's ONE door to the Fight object, generic across duels and PvM
// (the only variation anywhere is local vs remote; this file is the remote half's chain hand).
// Every action composes the PTB and executes. End Turn returns only the receipt's random mob
// witnesses for immediate deterministic presentation; the final state still reconciles from
// the indexer → server stream.

import { SDK, living_content } from './client.ts'
import { receipt_digest, receipt_event, receipt_events, type Receipt } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import {
  board_catalog_id,
  item_template_id,
  spell_template_id,
  mob_template_id,
  world_content_id,
  world_id,
} from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

export type FightTurnWitness = Readonly<{ fighter: bigint; seed: bigint }>
export const SETTLEMENT_BATCH_GAS_BUDGET_MIST = 1_000_000_000n
export type FightReceipt = {
  digest: string
  turn_witnesses?: readonly FightTurnWitness[]
  started?: boolean
  closable?: boolean
  closed?: boolean
}
export type FightCreatedReceipt = { digest: string; fight: string }
export type FightTurnAction =
  | Readonly<{ type: 'move'; path: readonly bigint[] }>
  | Readonly<{ type: 'cast'; fighter_idx: bigint; spell: string; target_cell: bigint }>
  | Readonly<{ type: 'strike'; fighter_idx: bigint; target_cell: bigint }>

export const created_fight_id = (receipt: Receipt): string => {
  const id = receipt_event(receipt, '::fight::FightCreated')?.fight
  if (typeof id !== 'string')
    throw new Error('The create receipt did not expose its FightCreated id; the fight was not guessed locally.')
  return id
}

const turn_witnesses = (receipt: Receipt): readonly FightTurnWitness[] =>
  Object.freeze(
    receipt_events(receipt, '::fight::TurnSeedUsed').map((event) => {
      if (typeof event.seat !== 'string' || typeof event.seed !== 'string')
        throw new Error('The turn receipt carried a malformed TurnSeedUsed witness.')
      return Object.freeze({ fighter: BigInt(event.seat), seed: BigInt(event.seed) })
    })
  )

export const project_fight_boundary_receipt = (receipt: Receipt): FightReceipt =>
  Object.freeze({
    digest: receipt_digest(receipt),
    turn_witnesses: turn_witnesses(receipt),
    started: receipt_event(receipt, '::fight::FightStarted') !== null,
  })

export const last_settler_refusal = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  const before_submission =
    !message.includes('failed on-chain') &&
    (/transaction resolution failed/i.test(message) || message.includes('NOT submitted'))
  return before_submission && /abort code:\s*1729/i.test(message)
}

export const execute_settlement_mode = async <T>(
  last: boolean | undefined,
  execute: (last: boolean) => Promise<T>
): Promise<T> => {
  if (last !== undefined) return execute(last)
  return execute(true).catch((error: unknown) => {
    if (!last_settler_refusal(error)) throw error
    return execute(false)
  })
}

export type FightActionsCtx = {
  /** async loader — the session's cached personal kiosk caps (kiosks are for life) */
  kiosk_cap: KioskCapLoader
}

/** The builder: every remote-fight chain action, duel and PvM alike. */
export const fight_actions = (sdk: GameSdk, { kiosk_cap }: FightActionsCtx) => {
  const scope_of = (fight: string): string => `fight:${fight}`
  const project_receipt = (receipt: Receipt): FightReceipt => ({ digest: receipt_digest(receipt) })
  const submit = async (fight: string, compose: (tx: ReturnType<GameSdk['tx']>) => void): Promise<FightReceipt> => {
    const tx = sdk.tx()
    compose(tx)
    const receipt = await sdk.execute(tx, { gas_scope: scope_of(fight) })
    return project_receipt(receipt)
  }

  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)

  /** External fight ids get one explicit read. Own fights already reconstruct their shared ref
   *  from the creation receipt; neither path polls a load-balanced node. */
  const hydrate_fight = (fight: string) => sdk.hydrate_unknown([fight])

  /** One seat may atomically become the final Ready and start the fight. */
  const ready = async ({ fight, fighter_idx }: { fight: string; fighter_idx: bigint }) => {
    await hydrate_fight(fight)
    const tx = sdk.tx()
    sdk.doors.ready_and_start_fight(tx, { fight_object: fight, fighter_idx })
    const receipt = await sdk.execute(tx, { gas_scope: scope_of(fight) })
    return project_fight_boundary_receipt(receipt)
  }

  return {
    /** Open a duel at the caller's proven spot; side B is RESERVED for `target` — the
     *  challenge IS the invitation, and no other character can take that seat. */
    challenge_duel: async ({
      character_id,
      target,
      custody,
      x,
      z,
      access = 0,
    }: {
      character_id: string
      /** the challenged CHARACTER — the chain reserves side B for it */
      target: string
      /** wire custody: the kiosk HOLDING the character + its personal cap */
      custody?: KioskCustody
      x: number
      z: number
      access?: number
    }): Promise<FightCreatedReceipt> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Fight transaction')
      const catalog = board_catalog_id(content_root, seed_package_original)
      await sdk.hydrate_unknown([catalog])
      // TERMINAL (&Random) door — the reference borrow keeps it the last command
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.challenge_duel(tx, { kiosk, personal, character_id, target, x, z, access, catalog }),
        { custody }
      )
      const fight = created_fight_id(receipt)
      sdk.tag_gas?.(receipt, scope_of(fight))
      return { digest: receipt_digest(receipt), fight }
    },

    /** Engage a roaming mob group (PvM): engage → add every mob → launch, one transaction. */
    engage: async ({
      character_id,
      custody,
      world,
      zone_x,
      zone_z,
      group_index,
      mob_types,
      access = 0,
    }: {
      character_id: string
      world: string
      zone_x: number
      zone_z: number
      group_index: bigint | number
      mob_types: readonly string[]
      access?: number
      custody?: KioskCustody
    }): Promise<FightCreatedReceipt> => {
      const { content_root, seed_package_original } = living_content(sdk, 'Fight transaction')
      const templates = mob_types.map((mob_type) => mob_template_id(content_root, seed_package_original, mob_type))
      const catalog = board_catalog_id(content_root, seed_package_original)
      const game_original = sdk.game_type_package
      if (!game_original) throw new Error('Fight transaction unavailable: pins.json has no original game package')
      const world_object = world_id(content_root, game_original, world)
      const world_content = world_content_id(content_root, seed_package_original, world)
      await sdk.hydrate_unknown([...templates, catalog, world_object, world_content])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          const build = sdk.doors.engage_fight(tx, {
            kiosk,
            cap,
            character_id,
            world_object,
            world_content,
            zone_x,
            zone_z,
            group_index,
            access,
            catalog,
          })
          const grown = templates.reduce(
            (potato, template) => sdk.doors.add_fight_mob(tx, { build: potato, template }),
            build
          )
          sdk.doors.launch_fight(tx, { build: grown })
        },
        { custody }
      )
      const fight = created_fight_id(receipt)
      sdk.tag_gas?.(receipt, scope_of(fight))
      return { digest: receipt_digest(receipt), fight }
    },

    join: async ({
      fight,
      character_id,
      custody,
      team,
      access = 0,
      party,
    }: {
      fight: string
      character_id: string
      custody?: KioskCustody
      team: number
      access?: number
      party?: string
    }): Promise<FightReceipt> => {
      await hydrate_fight(fight)
      if (party) await sdk.hydrate_unknown([party])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          if (party)
            sdk.doors.join_fight_grouped(tx, {
              fight_object: fight,
              kiosk,
              cap,
              character_id,
              team,
              shared_party: party,
            })
          else sdk.doors.join_fight(tx, { fight_object: fight, kiosk, cap, character_id, team, access })
        },
        { custody, gas_scope: scope_of(fight) }
      )
      return project_receipt(receipt)
    },

    join_many: async ({
      fight,
      character_ids,
      custody,
      team,
      access = 0,
      party,
    }: {
      fight: string
      character_ids: readonly string[]
      custody: KioskCustody
      team: number
      access?: number
      party?: string
    }): Promise<FightReceipt> => {
      if (character_ids.length === 0) throw new Error('A grouped fight join needs at least one character')
      await hydrate_fight(fight)
      if (party) await sdk.hydrate_unknown([party])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          character_ids.forEach((character_id) => {
            if (party)
              sdk.doors.join_fight_grouped(tx, {
                fight_object: fight,
                kiosk,
                cap,
                character_id,
                team,
                shared_party: party,
              })
            else sdk.doors.join_fight(tx, { fight_object: fight, kiosk, cap, character_id, team, access })
          })
        },
        { custody, gas_scope: scope_of(fight) }
      )
      return project_receipt(receipt)
    },

    place: async ({ fight, fighter_idx, cell }: { fight: string; fighter_idx: bigint; cell: bigint }) => {
      await hydrate_fight(fight)
      return submit(fight, (tx) => sdk.doors.place_fighter(tx, { fight_object: fight, fighter_idx, cell }))
    },

    /** Current shared truth decides whether this ready is the atomic final ready + start. */
    ready,

    ready_many: async ({
      fight,
      fighter_indices,
      on_progress,
    }: {
      fight: string
      fighter_indices: readonly bigint[]
      on_progress?: (
        progress: Readonly<{ completed: number; total: number; fighter_idx: bigint; started: boolean }>
      ) => void
    }) => {
      const seats = [...new Set(fighter_indices)]
      if (seats.length === 0) throw new Error('Ready all needs at least one fighter')
      await hydrate_fight(fight)
      const tx = sdk.tx()
      for (const fighter_idx of seats.slice(0, -1)) sdk.doors.ready_fight(tx, { fight_object: fight, fighter_idx })
      const final_fighter = seats.at(-1)!
      sdk.doors.ready_and_start_fight(tx, { fight_object: fight, fighter_idx: final_fighter })
      const receipt = await sdk.execute(tx, { gas_scope: scope_of(fight) })
      const projected = project_fight_boundary_receipt(receipt)
      on_progress?.({
        completed: seats.length,
        total: seats.length,
        fighter_idx: final_fighter,
        started: projected.started === true,
      })
      return projected
    },

    start: async ({ fight }: { fight: string }) => {
      await hydrate_fight(fight)
      const tx = sdk.tx()
      sdk.doors.start_fight(tx, { fight_object: fight })
      const receipt = await sdk.execute(tx, { gas_scope: scope_of(fight) })
      return project_fight_boundary_receipt(receipt)
    },

    /** One staged turn becomes one PTB. A lethal action is already its terminal boundary. */
    commit_turn: async ({
      fight,
      actions,
      ended = false,
    }: {
      fight: string
      actions: readonly FightTurnAction[]
      ended?: boolean
    }) => {
      const { content_root, seed_package_original } = living_content(sdk, 'Fight transaction')
      const spell_templates = new Map(
        actions.flatMap((action) =>
          action.type === 'cast'
            ? [[action.spell, spell_template_id(content_root, seed_package_original, action.spell)] as const]
            : []
        )
      )
      await hydrate_fight(fight)
      await sdk.hydrate_unknown([...spell_templates.values()])
      const tx = sdk.tx()
      actions.forEach((action) => {
        if (action.type === 'move') sdk.doors.move_fighter(tx, { fight_object: fight, path: action.path })
        else if (action.type === 'cast')
          sdk.doors.cast_spell(tx, {
            fight_object: fight,
            fighter_idx: action.fighter_idx,
            spell: spell_templates.get(action.spell)!,
            target_cell: action.target_cell,
          })
        else
          sdk.doors.weapon_strike(tx, {
            fight_object: fight,
            fighter_idx: action.fighter_idx,
            target_cell: action.target_cell,
          })
      })
      if (!ended) sdk.doors.end_fight_turn(tx, { fight_object: fight })
      const receipt = await sdk.execute(tx, { gas_scope: scope_of(fight) })
      return Object.freeze({
        digest: receipt_digest(receipt),
        turn_witnesses: turn_witnesses(receipt),
      })
    },

    crank: async ({ fight }: { fight: string }) => {
      await hydrate_fight(fight)
      return submit(fight, (tx) => sdk.doors.crank_fight(tx, { fight_object: fight }))
    },

    forfeit: async ({
      fight,
      fighter_idx,
      custody,
    }: {
      fight: string
      fighter_idx: bigint
      custody?: KioskCustody
    }): Promise<FightReceipt> => {
      await hydrate_fight(fight)
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.forfeit_fight(tx, { fight_object: fight, fighter_idx, kiosk, cap }),
        { custody, gas_scope: scope_of(fight) }
      )
      return project_receipt(receipt)
    },

    settle: async ({
      fight,
      settlements,
      custody,
      last,
    }: {
      fight: string
      settlements: readonly Readonly<{
        fighter_idx: bigint
        loot: readonly Readonly<{ item_type: string; existing: string | null }>[]
      }>[]
      custody?: KioskCustody
      last?: boolean
    }): Promise<FightReceipt> => {
      if (settlements.length === 0) throw new Error('Fight settlement batch is empty')
      const { content_root, seed_package_original } = living_content(sdk, 'Fight settlement')
      const normalized = settlements.map((settlement) =>
        Object.freeze({
          ...settlement,
          loot: [...new Map(settlement.loot.map((row) => [row.item_type, row])).values()],
        })
      )
      const templates = [
        ...new Set(
          normalized.flatMap(({ loot }) =>
            loot.map(({ item_type }) => item_template_id(content_root, seed_package_original, item_type))
          )
        ),
      ]
      await sdk.hydrate_unknown([fight, ...templates])
      const execute_settlement = (final: boolean) =>
        with_terminal_kiosk(
          (tx, kiosk, personal) => {
            const plan = normalized.flatMap(({ loot }) =>
              loot.map(({ item_type, existing }) =>
                sdk.doors.prepare_fight_loot(tx, {
                  template: item_template_id(content_root, seed_package_original, item_type),
                  existing,
                })
              )
            )
            const args = {
              fight_object: fight,
              fighter_indices: normalized.map(({ fighter_idx }) => fighter_idx),
              plan_lengths: normalized.map(({ loot }) => loot.length),
              plan,
              kiosk,
              personal,
            }
            if (final) sdk.doors.settle_last_fight(tx, args)
            else sdk.doors.settle_fight(tx, args)
          },
          { custody, gas_scope: scope_of(fight), budget: SETTLEMENT_BATCH_GAS_BUDGET_MIST }
        )
      const receipt = await execute_settlement_mode(last, execute_settlement)
      return Object.freeze({
        ...project_receipt(receipt),
        closable: receipt_event(receipt, '::fight::FightClosable') !== null,
        closed: receipt_event(receipt, '::fight::FightClosed') !== null,
      })
    },

    /** Explicit recovery for fights stranded by older clients. Current final settlements
     * reclaim storage atomically through the terminal batch door. */
    close: async ({ fight }: { fight: string }): Promise<FightReceipt> => {
      await hydrate_fight(fight)
      return submit(fight, (tx) => sdk.doors.close_fight(tx, { fight_object: fight }))
    },
    gas_spent: (fight: string): bigint => sdk.gas_spent_24h?.(scope_of(fight)) ?? 0n,
  }
}

export type FightActions = ReturnType<typeof fight_actions>
