// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight builder — the app's ONE door to the Fight object, generic across duels and PvM
// (the only variation anywhere is local vs remote; this file is the remote half's chain hand).
// Every action composes the PTB and executes. End Turn returns only the receipt's random mob
// witnesses for immediate deterministic presentation; the final state still reconciles from
// the indexer → server stream.

import { SDK, seed_registry, world_ref } from './client.ts'
import { receipt_digest, receipt_event, receipt_events, type Receipt } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { item_template_id, spell_template_id, mob_template_id } from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

export type FightTurnWitness = Readonly<{ fighter: bigint; seed: bigint }>
export type FightReceipt = { digest: string; turn_witnesses?: readonly FightTurnWitness[] }
export type FightCreatedReceipt = { digest: string; fight: string }
export type FightTurnAction =
  | Readonly<{ type: 'move'; path: readonly bigint[] }>
  | Readonly<{ type: 'cast'; fighter_idx: bigint; spell: string; target_cell: bigint }>
  | Readonly<{ type: 'strike'; fighter_idx: bigint; target_cell: bigint }>

const created_fight_id = (receipt: Receipt): string => {
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

export type FightActionsCtx = {
  /** async loader — the session's cached personal kiosk caps (kiosks are for life) */
  kiosk_cap: KioskCapLoader
}

/** The builder: every remote-fight chain action, duel and PvM alike. */
export const fight_actions = (sdk: GameSdk, { kiosk_cap }: FightActionsCtx) => {
  const submit = async (compose: (tx: ReturnType<GameSdk['tx']>) => void): Promise<FightReceipt> => {
    const tx = sdk.tx()
    compose(tx)
    const receipt = await sdk.execute(tx)
    return { digest: receipt_digest(receipt) }
  }

  const { with_kiosk, with_terminal_kiosk } = create_kiosk_runner(sdk, kiosk_cap)

  /** A shared Fight id becomes resolvable once — shared refs are stable for life. A duel's
   *  acceptor learns the id from the challenger the instant their transaction lands, so this
   *  WAITS for the node to catch up rather than failing on a fight that provably exists. */
  const hydrate_fight = (fight: string) => sdk.hydrate_required([fight])

  return {
    /** Open a duel at the caller's proven spot; side B is RESERVED for `target` — the
     *  challenge IS the invitation, and no other character can take that seat. */
    challenge_duel: async ({
      character_id,
      target,
      custody,
      x,
      z,
      access = 1,
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
      // TERMINAL (&Random) door — the reference borrow keeps it the last command
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.challenge_duel(tx, { kiosk, personal, character_id, target, x, z, access }),
        { custody }
      )
      return { digest: receipt_digest(receipt), fight: created_fight_id(receipt) }
    },

    /** Engage a roaming mob group (PvM): engage → add every mob → launch, one transaction. */
    engage: async ({
      character_id,
      custody,
      world,
      zx,
      zz,
      group_index,
      mob_types,
      access = 1,
    }: {
      character_id: string
      world: string
      zx: number
      zz: number
      group_index: bigint | number
      mob_types: readonly string[]
      access?: number
      custody?: KioskCustody
    }): Promise<FightCreatedReceipt> => {
      const { registry, package_id } = seed_registry(sdk, 'Fight transaction')
      const templates = mob_types.map((mob_type) => mob_template_id(registry, package_id, mob_type))
      const w = world_ref(sdk.pins, world)
      await sdk.hydrate_unknown(templates)
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          const build = sdk.doors.engage_fight(tx, { kiosk, cap, character_id, w, zx, zz, group_index, access })
          const grown = templates.reduce(
            (potato, template) => sdk.doors.add_fight_mob(tx, { build: potato, template }),
            build
          )
          sdk.doors.launch_fight(tx, { build: grown })
        },
        { custody }
      )
      return { digest: receipt_digest(receipt), fight: created_fight_id(receipt) }
    },

    join: async ({
      fight,
      character_id,
      custody,
      team,
      access = 1,
    }: {
      fight: string
      character_id: string
      custody?: KioskCustody
      team: number
      access?: number
    }): Promise<FightReceipt> => {
      await hydrate_fight(fight)
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => sdk.doors.join_fight(tx, { f: fight, kiosk, cap, character_id, team, access }),
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    place: async ({ fight, fighter_idx, cell }: { fight: string; fighter_idx: bigint; cell: bigint }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.place_fighter(tx, { f: fight, fighter_idx, cell }))
    },

    /** The LAST seat's ready starts the fight in the same transaction (`and_start`) — the
     *  chain has no auto-start on ready, and start's &Random door legally follows ready. */
    ready: async ({
      fight,
      fighter_idx,
      and_start = false,
    }: {
      fight: string
      fighter_idx: bigint
      and_start?: boolean
    }) => {
      await hydrate_fight(fight)
      return submit((tx) => {
        sdk.doors.ready_fighter(tx, { f: fight, fighter_idx })
        if (and_start) sdk.doors.start_fight(tx, { f: fight })
      })
    },

    start: async ({ fight }: { fight: string }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.start_fight(tx, { f: fight }))
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
      const { registry, package_id } = seed_registry(sdk, 'Fight transaction')
      const spell_templates = new Map(
        actions.flatMap((action) =>
          action.type === 'cast' ? [[action.spell, spell_template_id(registry, package_id, action.spell)] as const] : []
        )
      )
      await hydrate_fight(fight)
      await sdk.hydrate_unknown([...spell_templates.values()])
      const tx = sdk.tx()
      actions.forEach((action) => {
        if (action.type === 'move') sdk.doors.move_fighter(tx, { f: fight, path: action.path })
        else if (action.type === 'cast')
          sdk.doors.cast_spell(tx, {
            f: fight,
            fighter_idx: action.fighter_idx,
            spell: spell_templates.get(action.spell)!,
            target_cell: action.target_cell,
          })
        else sdk.doors.weapon_strike(tx, { f: fight, fighter_idx: action.fighter_idx, target_cell: action.target_cell })
      })
      if (!ended) sdk.doors.end_fight_turn(tx, { f: fight })
      const receipt = await sdk.execute(tx)
      return Object.freeze({
        digest: receipt_digest(receipt),
        turn_witnesses: turn_witnesses(receipt),
      })
    },

    crank: async ({ fight }: { fight: string }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.crank_fight(tx, { f: fight }))
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
        (tx, kiosk, cap) => sdk.doors.forfeit_fight(tx, { f: fight, fighter_idx, kiosk, cap }),
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    settle: async ({
      fight,
      fighter_idx,
      custody,
    }: {
      fight: string
      fighter_idx: bigint
      custody?: KioskCustody
    }): Promise<FightReceipt> => {
      await hydrate_fight(fight)
      // TERMINAL (&Random) door — the reference borrow keeps it the last command
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.settle_fight(tx, { f: fight, fighter_idx, kiosk, personal }),
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },

    /** Claim every rolled row of one item type. The Move door consumes duplicate rows in one
     *  transaction, so the result card and inventory never need an intermediate refresh. */
    claim_drop: async ({
      fight,
      fighter_idx,
      item_type,
      existing,
      custody,
    }: {
      fight: string
      fighter_idx: bigint
      item_type: string
      existing: string | null
      custody?: KioskCustody
    }): Promise<FightReceipt> => {
      const { registry } = seed_registry(sdk, 'Fight loot claim')
      const template = item_template_id(registry, item_type)
      await sdk.hydrate_unknown([fight, template])
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) =>
          sdk.doors.claim_fight_drop(tx, {
            f: fight,
            fighter_idx,
            template,
            existing,
            kiosk,
            personal,
          }),
        { custody }
      )
      return { digest: receipt_digest(receipt) }
    },
  }
}

export type FightActions = ReturnType<typeof fight_actions>
