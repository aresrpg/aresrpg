// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The remote fight's chain edge — observe-only (the fight reducer stays in fight.ts). Every
// LOCAL input in a remote fight is chain truth: one transaction per action, submitted here
// while the optimistic relay (session.ts → packet/fight_action) smooths the other screens.
// A refused transaction surfaces as an error toast — no silent failure, no auto-retry.

import type { FightInput, HydratedFightCheckpoint } from '@aresrpg/fight'
import type { FightActions } from '@aresrpg/sdk/auth'

import type { AppModule } from '../store.ts'
import { toast } from '../toast.ts'

/** The chain has no auto-start on ready — the LAST seat's ready carries the start in the
 *  same transaction, so the fight begins the moment the final player clicks ready. */
const last_ready = (checkpoint: Readonly<HydratedFightCheckpoint>, seat: bigint): boolean =>
  checkpoint.contract.fighters.every(
    (fighter, index) => BigInt(index) === seat || fighter.kind.type === 'mob' || fighter.dead || fighter.ready
  )

const submit = (
  fight: string,
  input: Readonly<FightInput>,
  actions: Readonly<FightActions>,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  custody: Readonly<{ kiosk: string; kiosk_cap?: string }> | undefined
): Promise<unknown> | null => {
  switch (input.type) {
    case 'place':
      return actions.place({ fight, fighter_idx: input.fighter, cell: input.cell })
    case 'ready':
      return actions.ready({ fight, fighter_idx: input.fighter, and_start: last_ready(checkpoint, input.fighter) })
    case 'start':
      return actions.start({ fight })
    case 'move_to':
      return actions.move({ fight, path: input.path })
    case 'cast_spell':
      return actions.cast({ fight, fighter_idx: input.fighter, spell: input.spell, target_cell: input.target_cell })
    case 'weapon_strike':
      return actions.strike({ fight, fighter_idx: input.fighter, target_cell: input.target_cell })
    case 'end_turn':
      return actions.end_turn({ fight })
    case 'crank':
      return actions.crank({ fight })
    case 'forfeit':
      return actions.forfeit({ fight, fighter_idx: input.fighter, custody })
    default:
      return null // turn_seed / join are witnesses and chain echoes — never locally born
  }
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state }) => {
  events.on('fight/input', ({ input, origin }) => {
    const state = get_state()
    const { wallet } = state.session
    if (origin !== 'local' || state.fight.mode !== 'remote' || !state.fight.checkpoint || !wallet) return
    const fight = state.fight.checkpoint.contract.id
    const row = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const custody = row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined
    void submit(fight, input, wallet.fight, state.fight.checkpoint, custody)?.catch((error: unknown) =>
      toast.add(error)
    )
  })

  // THE END: the chain closed the fight — settle the own unsettled seat (duels are
  // consequence-free; PvM takes xp + rolls drops), then release the surface.
  const settled = new Set<string>()
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/fight_ended') return
    const state = get_state()
    const { wallet } = state.session
    const { checkpoint } = state.fight
    if (state.fight.mode !== 'remote' || !checkpoint || checkpoint.contract.id !== packet.fight || !wallet) return
    const seat = checkpoint.contract.fighters.findIndex(
      (fighter) => fighter.kind.type === 'player' && fighter.kind.owner === wallet.address && !fighter.settled
    )
    if (seat >= 0 && !settled.has(packet.fight)) {
      settled.add(packet.fight)
      void wallet.fight
        .settle({
          fight: packet.fight,
          fighter_idx: BigInt(seat),
          custody: (() => {
            const row = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
            return row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined
          })(),
        })
        .catch((error: unknown) => toast.add(error))
    }
    // the surface is NOT released here: closing on the packet's arrival cuts the final blow's
    // death cue mid-animation. `fight_should_close` releases it from the observed state once the
    // presentation has drained — one exit rule for forfeiting, losing and winning alike.
  })
}

// the no-op reduce keeps the MODULES union uniform (world.ts's no-op observe precedent)
export default Object.freeze({ name: 'fight_chain', reduce: (state) => state, observe }) satisfies AppModule
