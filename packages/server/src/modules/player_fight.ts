// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE FIGHT STREAM. Every tracked character's custody fight stays watched simultaneously;
// an optional spectator watch is anchored to an explicit character. Overlapping characters
// share the same indexer + action subscriptions, and full checkpoints feed the client cache.

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

type FighterEntry = { kind: { type: string; character?: string; owner?: string }; settled?: boolean }

/** Only the newest requested checkpoint may publish. Graph reads are async; without this gate,
 * a slow placement read can arrive after a completed mob wave and roll every client back. */
export const latest_fight_state_reader = <T>(
  read: (fight: string) => Promise<T>,
  deliver: (fight: string, state: T) => void
) => {
  const generations = new Map<string, number>()
  return (fight: string): Promise<void> => {
    const generation = (generations.get(fight) ?? 0) + 1
    generations.set(fight, generation)
    return read(fight).then((state) => {
      if (generations.get(fight) === generation) deliver(fight, state)
    })
  }
}

export default {
  name: 'player_fight',

  reduce: (state, action) => {
    if (action.type === 'action/fight') {
      const tracked = state.characters[action.character_id]
      if (!tracked) return state
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character_id]: {
            ...tracked,
            fight: action.fight,
            fight_seat: action.fight === null ? null : action.seat === undefined ? tracked.fight_seat : action.seat,
            active_fighter:
              action.fight === null
                ? null
                : action.active_fighter === undefined
                  ? tracked.active_fighter
                  : action.active_fighter,
          },
        },
      }
    }
    if (action.type === 'action/spectate')
      return {
        ...state,
        spectating: action.fight ? { character_id: action.character_id, fight: action.fight } : null,
      }
    return state
  },

  observe: (context) => {
    const { pubsub, graph, events, send, address, dispatch, get_state, signal } = context
    const { watch, unwatch, watched } = create_watcher(pubsub)
    const fight_tails = new Map<string, Promise<void>>()
    const enqueue_fight = (fight: string, work: () => Promise<void>): void => {
      const next = (fight_tails.get(fight) ?? Promise.resolve()).then(work)
      fight_tails.set(
        fight,
        next.catch((error: Error) => log.warn({ fight, error: error.message }, 'ordered fight stream failed'))
      )
    }

    const project_authority = (fight_id: string, state: Awaited<ReturnType<typeof get_fight_checkpoint>>) => {
      if (!state) return null
      const fighters = (state.contract as { fighters: FighterEntry[] }).fighters ?? []
      const seats = Object.fromEntries(
        fighters.flatMap((fighter, seat) => {
          const kind = fighter.kind as { type?: string; character?: string; owner?: string }
          const settled = fighter.settled === true
          return kind.owner === address && kind.character && !settled ? [[kind.character, seat] as const] : []
        })
      )
      const contract = state.contract as {
        ended?: boolean
        round?: bigint | number | string
        turn_ptr?: bigint | number | string
        queue?: readonly (bigint | number | string)[]
      }
      const turn_ptr = Number(contract.turn_ptr ?? 0)
      const active_fighter =
        !contract.ended && Number(contract.round ?? 0) > 0 ? Number(contract.queue?.[turn_ptr] ?? -1) : null
      Object.entries(seats).forEach(([character_id, seat]) =>
        dispatch({ type: 'action/fight', character_id, fight: fight_id, seat, active_fighter })
      )
      Object.entries(get_state().characters).forEach(([character_id, tracked]) => {
        if (tracked.fight === fight_id && !(character_id in seats))
          dispatch({ type: 'action/fight', character_id, fight: null })
      })
      return { state, seats }
    }

    /** The full projected checkpoint — pushed on arm and on every STRUCTURAL beacon
     *  (roster/queue changes the light packets cannot carry); the client replaces into it. */
    const read_latest_state = latest_fight_state_reader(
      (fight_id) => get_fight_checkpoint(graph, { fight_id }),
      (fight_id, state) => {
        const projected = project_authority(fight_id, state)
        if (projected) send({ type: 'packet/fight_state', fight: fight_id, ...projected })
      }
    )
    const push_state = (fight_id: string) =>
      read_latest_state(fight_id).catch((error: Error) =>
        log.warn({ fight: fight_id, error: error.message }, 'fight state read failed')
      )

    const forward_fight_event = (payload: EventEnvelope) => {
      if (payload.type === 'FighterJoined') {
        const { fight } = payload.data as { fight: string }
        void push_state(fight) // the roster grew — light packets cannot carry the new source
      }
      if (payload.type === 'FightStarted') {
        const { fight, queue } = payload.data as { fight: string; queue: string[] }
        // the relay's wall clock is the start-time witness for watchers armed since placement
        send({ type: 'packet/fight_started', fight, queue, started_ms: String(payload.ts_ms) })
      }
      if (payload.type === 'FighterForfeited') {
        const { fight, fighter } = payload.data as { fight: string; fighter: number | string }
        send({ type: 'packet/fighter_forfeited', fight, fighter: String(fighter) })
      }
      if (payload.type === 'TurnSeedUsed') {
        const { fight, seat, seed } = payload.data as { fight: string; seat: string; seed: string }
        // Seed witnesses must retain event order. The trailing FightProjected write is queued
        // behind them and sends the final pools/cells after the replay has everything it needs.
        enqueue_fight(fight, async () => {
          const state = await get_fight_checkpoint(graph, { fight_id: fight })
          project_authority(fight, state)
          send({ type: 'packet/turn_seed', fight, seat, seed })
        })
      }
      if (payload.type === 'DropsRolled') {
        const { fight, fighter, drops } = payload.data as {
          fight: string
          fighter: string
          drops: { item_type: string; qty: number }[]
        }
        send({ type: 'packet/fight_drops', fight, fighter, drops })
      }
      if (payload.type === 'FightProjected') {
        const { fight } = payload.data as { fight: string }
        enqueue_fight(fight, () => push_state(fight))
      }
      if (payload.type === 'FightEnded') {
        const { fight, winner } = payload.data as { fight: string; winner: number | null }
        send({ type: 'packet/fight_ended', fight, winner })
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
        dispatch({ type: 'action/spectate', character_id: action.character_id, fight: null })
        return
      }
      const tracked = get_state().characters[action.character_id]
      if (!tracked) return
      const character = tracked.presence
      if (tracked.fight && tracked.fight !== action.fight) {
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
          dispatch({ type: 'action/spectate', character_id: action.character_id, fight: action.fight! })
        })
        .catch((error: Error) => log.warn({ fight: action.fight, error: error.message }, 'spectate read failed'))
    })

    // LIVE TURN INTENT — relayed to the other watchers of the same fight.
    // TODO(sim): once the simulation package lands, validate the action is LEGAL for the
    // current fight state before relaying (owner 2026-08-12) — shape-checked-only until then.
    events.on('packet/fight_action', (action: Extract<PlayerAction, { type: 'packet/fight_action' }>) => {
      const state = get_state()
      const fighter = Number(action.action.fighter)
      const tracked = Object.values(state.characters).find(
        ({ fight, fight_seat }) => fight === action.fight && fight_seat === fighter
      )
      if (!tracked) {
        send({
          type: 'packet/error',
          reason: state.spectating?.fight === action.fight ? 'not your fighter' : 'not in this fight',
        })
        return
      }
      const placement_action = action.action.type === 'place' || action.action.type === 'ready'
      const anytime_action = action.action.type === 'forfeit'
      if (!placement_action && !anytime_action && fighter !== tracked.active_fighter) {
        send({ type: 'packet/error', reason: 'not your turn' })
        return
      }
      void pubsub.mesh.publish(mesh.fight_actions(action.fight), { address, action: action.action })
    })

    // Watch the union of every owned fight plus the optional spectator fight.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const fights_of = (value: PlayerState): Set<string> =>
        new Set([
          ...Object.values(value.characters).flatMap(({ fight }) => (fight ? [fight] : [])),
          ...(value.spectating ? [value.spectating.fight] : []),
        ])
      const before = fights_of(previous)
      const current = fights_of(state)
      before.forEach((fight) => {
        if (current.has(fight)) return
        unwatch(channels.fight(fight))
        unwatch(mesh.fight_actions(fight))
      })
      current.forEach((fight) => {
        if (before.has(fight)) return
        void Promise.all([
          watch(channels.fight(fight), forward_fight_event as (payload: never) => void),
          watch(mesh.fight_actions(fight), forward_fight_action(fight) as (payload: never) => void),
        ])
          .then(() => {
            if (fights_of(get_state()).has(fight)) void push_state(fight)
          })
          .catch((error: Error) => log.warn({ fight, error: error.message }, 'fight watch failed'))
      })
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
