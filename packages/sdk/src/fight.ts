// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The fight builder — the app's ONE door to the Fight object, generic across duels and PvM
// (the only variation anywhere is local vs remote; this file is the remote half's chain hand).
// Every action composes the PTB and executes; the resulting state change comes back to the
// client as chain truth (indexer → server stream), never folded locally from the receipt —
// the fight core already replays every action deterministically.

import { SDK } from './client.ts'
import { receipt_digest, receipt_event, type Receipt } from './cache.ts'
import { create_kiosk_runner, type KioskCapLoader, type KioskCustody } from './kiosk_runner.ts'
import { spell_template_id, mob_template_id } from './seed_ids.ts'

type GameSdk = ReturnType<typeof SDK>

export type FightReceipt = { digest: string }
export type FightCreatedReceipt = { digest: string; fight: string }

const created_fight_id = (receipt: Receipt): string => {
  const id = receipt_event(receipt, '::fight::FightCreated')?.fight
  if (typeof id !== 'string')
    throw new Error('The create receipt did not expose its FightCreated id; the fight was not guessed locally.')
  return id
}

const registry_of = (sdk: GameSdk): { registry: string; package_id: string } => {
  const registry = sdk.pins.template_registry
  const package_id = sdk.pins.package
  const id = typeof registry === 'object' && registry !== null ? Reflect.get(registry, 'id') : registry
  if (typeof id !== 'string' || typeof package_id !== 'string')
    throw new Error('Fight transaction unavailable: pins.json has no template registry for this network.')
  return { registry: id, package_id }
}

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
    /** Open a duel at the caller's proven spot; side B waits for the acceptor. */
    challenge_duel: async ({
      character_id,
      custody,
      x,
      z,
      access = 1,
    }: {
      character_id: string
      /** wire custody: the kiosk HOLDING the character + its personal cap */
      custody?: KioskCustody
      x: number
      z: number
      access?: number
    }): Promise<FightCreatedReceipt> => {
      // TERMINAL (&Random) door — the reference borrow keeps it the last command
      const receipt = await with_terminal_kiosk(
        (tx, kiosk, personal) => sdk.doors.challenge_duel(tx, { kiosk, personal, character_id, x, z, access }),
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
      const { registry, package_id } = registry_of(sdk)
      const templates = mob_types.map((mob_type) => mob_template_id(registry, package_id, mob_type))
      await sdk.hydrate_unknown([world, ...templates])
      const receipt = await with_kiosk(
        (tx, kiosk, cap) => {
          const build = sdk.doors.engage_fight(tx, { kiosk, cap, character_id, w: world, zx, zz, group_index, access })
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

    move: async ({ fight, path }: { fight: string; path: readonly bigint[] }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.move_fighter(tx, { f: fight, path }))
    },

    cast: async ({
      fight,
      fighter_idx,
      spell,
      target_cell,
    }: {
      fight: string
      fighter_idx: bigint
      spell: string
      target_cell: bigint
    }) => {
      const { registry, package_id } = registry_of(sdk)
      const template = spell_template_id(registry, package_id, spell)
      await sdk.hydrate_unknown([fight, template])
      return submit((tx) => sdk.doors.cast_spell(tx, { f: fight, fighter_idx, spell: template, target_cell }))
    },

    strike: async ({
      fight,
      fighter_idx,
      target_cell,
    }: {
      fight: string
      fighter_idx: bigint
      target_cell: bigint
    }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.weapon_strike(tx, { f: fight, fighter_idx, target_cell }))
    },

    end_turn: async ({ fight }: { fight: string }) => {
      await hydrate_fight(fight)
      return submit((tx) => sdk.doors.end_fight_turn(tx, { f: fight }))
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
  }
}

export type FightActions = ReturnType<typeof fight_actions>
