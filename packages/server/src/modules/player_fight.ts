// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT STREAM. One watch slot (state.fight): the OWN seat arms it automatically from
// CUSTODY — `CharacterSeated` on the self stream while connected, the embody read for a seat
// taken before this socket existed (a reconnect, or a fight whose creator was seated at its
// birth); a SPECTATE intent arms it after proving the fight is nearby. The delta mounts two
// channels: the indexer's evt:fight (chain beacons) and the act:fight mesh (other fighters'
// live turn intents). FightEnded disarms the slot itself.

import { zone_of } from '@aresrpg/protocol'

import { channels, mesh, type EventEnvelope, type FightActionFact } from '../protocol.ts'
import { get_fight } from '../reads/get_fight.ts'
import { get_fight_checkpoint } from '../reads/get_fight_checkpoint.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerAction, PlayerState } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

/** How far (in zones) a spectated fight may stand from the player — the tracked spiral. */
const SPECTATE_RADIUS = 1

type FighterEntry = { kind: { type: string; character?: string; owner?: string } }

export default {
  name: 'player_fight',

  reduce: (state, action) => {
    if (action.type === 'action/fight') return { ...state, fight: action.fight }
    if (action.type === 'close') return state.fight ? { ...state, fight: null } : state
    return state
  },

  observe: (context) => {
    const { pubsub, graph, events, send, address, dispatch, get_state, signal } = context
    const { watch, unwatch, watched } = create_watcher(pubsub)

    /** The full projected checkpoint — pushed on arm and on every STRUCTURAL beacon
     *  (roster/queue changes the light packets cannot carry); the client replaces into it. */
    const push_state = (fight_id: string) =>
      get_fight_checkpoint(graph, { fight_id })
        .then((state) => {
          if (!state) return
          const fighters = (state.contract as { fighters: FighterEntry[] }).fighters ?? []
          const seat = fighters.findIndex(
            (fighter) => (fighter.kind as { owner?: string } | undefined)?.owner === address
          )
          send({ type: 'packet/fight_state', fight: fight_id, state, seat })
        })
        .catch((error: Error) => log.warn({ fight: fight_id, error: error.message }, 'fight state read failed'))

    const forward_fight_event = (payload: EventEnvelope) => {
      if (payload.type === 'FighterJoined') {
        const { fight } = payload.data as { fight: string }
        void push_state(fight) // the roster grew — light packets cannot carry the new source
      }
      if (payload.type === 'FightStarted') {
        const { fight, queue } = payload.data as { fight: string; queue: string[] }
        // the relay's wall clock is the start-time witness for watchers armed since placement
        send({ type: 'packet/fight_started', fight, queue, started_ms: String(payload.ts_ms) })
        void push_state(fight) // queue + first turn seed live on the object
      }
      if (payload.type === 'FighterForfeited') {
        const { fight, fighter } = payload.data as { fight: string; fighter: number | string }
        send({ type: 'packet/fighter_forfeited', fight, fighter: String(fighter) })
      }
      if (payload.type === 'TurnSeedUsed') {
        const { fight, seat, seed } = payload.data as { fight: string; seat: string; seed: string }
        send({ type: 'packet/turn_seed', fight, seat, seed })
      }
      if (payload.type === 'DropsRolled') {
        const { fight, fighter, drops } = payload.data as {
          fight: string
          fighter: string
          drops: { item_type: string; qty: number }[]
        }
        send({ type: 'packet/fight_drops', fight, fighter, drops })
      }
      if (payload.type === 'FightEnded') {
        const { fight, winner } = payload.data as { fight: string; winner: number | null }
        send({ type: 'packet/fight_ended', fight, winner })
        dispatch({ type: 'action/fight', fight: null }) // the slot disarms itself
      }
    }

    const forward_fight_action = (fight: string) => (fact: FightActionFact) => {
      if (fact.address === address) return
      send({ type: 'packet/fight_action', fight, from: fact.address, action: fact.action })
    }

    // SPECTATE — the validation door: the fight must exist and stand in the tracked spiral.
    // The same arm doubles as the join/spectate MODAL's live watch: opening the modal arms
    // the stream, so seat changes reach it while it stands open. One watch slot — a fighter
    // never replaces their own fight's stream with somebody else's.
    events.on('packet/spectate', (action: Extract<PlayerAction, { type: 'packet/spectate' }>) => {
      if (action.fight === null) {
        dispatch({ type: 'action/fight', fight: null })
        return
      }
      const { character, fight: armed } = get_state()
      if (!character) return // spectating from nowhere is noise
      if (armed && armed !== action.fight) {
        send({ type: 'packet/error', reason: 'already watching a fight' })
        return
      }
      void get_fight(graph, { fight_id: action.fight })
        .then(([fight]) => {
          const nearby =
            fight &&
            fight.world === character.world &&
            Math.abs(zone_of(fight.x, fight.z).zx - zone_of(character.x, character.z).zx) <= SPECTATE_RADIUS &&
            Math.abs(zone_of(fight.x, fight.z).zz - zone_of(character.x, character.z).zz) <= SPECTATE_RADIUS
          if (!nearby) {
            send({ type: 'packet/error', reason: 'fight not nearby' })
            return
          }
          dispatch({ type: 'action/fight', fight: action.fight! })
        })
        .catch((error: Error) => log.warn({ fight: action.fight, error: error.message }, 'spectate read failed'))
    })

    // LIVE TURN INTENT — relayed to the other watchers of the same fight.
    // TODO(sim): once the simulation package lands, validate the action is LEGAL for the
    // current fight state before relaying (owner 2026-08-12) — shape-checked-only until then.
    events.on('packet/fight_action', (action: Extract<PlayerAction, { type: 'packet/fight_action' }>) => {
      if (get_state().fight !== action.fight) {
        send({ type: 'packet/error', reason: 'not in this fight' })
        return
      }
      void pubsub.mesh.publish(mesh.fight_actions(action.fight), { address, action: action.action })
    })

    // THE EFFECT DOOR — the watch follows the state slot; arming pushes the live fight row.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.fight === previous.fight) return
      if (previous.fight) {
        unwatch(channels.fight(previous.fight))
        unwatch(mesh.fight_actions(previous.fight))
      }
      if (!state.fight) return
      const armed = state.fight
      watch(channels.fight(armed), forward_fight_event as (payload: never) => void)
      watch(mesh.fight_actions(armed), forward_fight_action(armed) as (payload: never) => void)
      void push_state(armed)
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
