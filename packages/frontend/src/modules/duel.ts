// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The duel handshake — off-chain relay state (invite → accept/decline), one reducer. The chain
// only ever sees two transactions: the challenger's challenge_duel after the accept, and the
// acceptor's join once the FIGHT ITSELF arrives.
//
// THE RELAY CARRIES INTENT, NEVER CHAIN STATE (owner 2026-08-21). The challenger's fight
// reaches the acceptor as the indexer's own `packet/fight_created` on the zone channel — the
// projection is the trigger. A peer's word used to name the object we transacted against; a
// hostile one could have sealed our character into a fight we never agreed to. The acceptor
// now matches the streamed fight against the challenger's OWN standing position (the chain
// pins a duel to the challenger's proven cell), so only a fight born where they stand counts.
//
// VALIDITY IS DECIDED IN THE REDUCER (it alone sees the pre-fold state); effects observe the
// RESULTING DELTAS (`challenge`/`join` appearing) — never the input against post-fold state
// (that read a cleared field and died, audit 2026-08-20). Signals are honored only from the
// address actually being shaken hands with, and every chain failure surfaces as an error
// toast — no silent path.

import { DUEL_INVITE_TTL_MS, type DuelSignalKind } from '@aresrpg/protocol'
import { chain_to_client_coordinate, client_to_chain_coordinate } from '@aresrpg/immutable'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { toast } from '../toast.ts'

export type DuelState = Readonly<{
  /** someone asked US — the prompt the UI renders (accept/decline) */
  incoming: Readonly<{ from: string; character: string; at_ms: number }> | null
  /** we asked someone — pending until their answer (or TTL) */
  outgoing: Readonly<{ to: string; character: string; at_ms: number }> | null
  /** we accepted and await the challenger's fight appearing in our zone */
  accepted: Readonly<{ from: string; at_ms: number }> | null
  /** a valid accept landed — the challenge_duel transaction is due (effect clears it) */
  challenge: Readonly<{ to: string }> | null
  /** the indexer's fight matched our handshake — the join transaction is due (effect clears it) */
  join: Readonly<{ from: string; fight: string }> | null
}>

export type DuelInput =
  | Readonly<{ type: 'duel/invited'; to: string; character: string; at_ms: number }>
  | Readonly<{ type: 'duel/answered'; accept: boolean; to: string; at_ms: number }>
  | Readonly<{ type: 'duel/received'; from: string; character: string; kind: DuelSignalKind; at_ms: number }>
  | Readonly<{ type: 'duel/signal'; to: string; kind: DuelSignalKind }>
  | Readonly<{ type: 'duel/cleared' }>

export const initial_duel_state = (): DuelState =>
  Object.freeze({ incoming: null, outgoing: null, accepted: null, challenge: null, join: null })

export const duel_invite_expired = (at_ms: number, now_ms: number): boolean => now_ms - at_ms > DUEL_INVITE_TTL_MS

const with_duel = (state: AppState, duel: DuelState): AppState => Object.freeze({ ...state, duel })

/** How far a duel's fight may be born from the challenger's standing position, in world blocks.
 *  The chain pins it to their proven cell; this only absorbs the sub-block drift between the
 *  position stream and the checkpoint the transaction proved. */
const DUEL_ANCHOR_SLACK = 3

export const reduce_duel = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected' || input.type === 'duel/cleared')
    return with_duel(state, initial_duel_state())
  // THE FIGHT ARRIVES FROM THE INDEXER: a fight born, in our world, where the challenger we
  // accepted is standing, while that handshake is still alive — that is our duel, and nobody
  // said so but the projection.
  if (input.type === 'server/packet' && input.packet.type === 'packet/fight_created') {
    const { accepted } = state.duel
    const { packet } = input
    // no clock here: the observer's TTL timer clears `accepted`, so a live one IS in window
    if (!accepted) return state
    const challenger = Object.values(state.world.players).find(({ owner }) => owner === accepted.from)
    if (!challenger) return state
    const born = packet.fight
    const near =
      Math.abs(chain_to_client_coordinate(born.x) - challenger.x) <= DUEL_ANCHOR_SLACK &&
      Math.abs(chain_to_client_coordinate(born.z) - challenger.z) <= DUEL_ANCHOR_SLACK
    return near
      ? with_duel(state, {
          ...state.duel,
          accepted: null,
          join: Object.freeze({ from: accepted.from, fight: born.id }),
        })
      : state
  }
  if (input.type === 'duel/invited')
    return with_duel(state, {
      ...state.duel,
      outgoing: Object.freeze({ to: input.to, character: input.character, at_ms: input.at_ms }),
    })
  if (input.type === 'duel/answered')
    return with_duel(state, {
      ...state.duel,
      incoming: null,
      accepted:
        input.accept && state.duel.incoming?.from === input.to
          ? Object.freeze({ from: input.to, at_ms: input.at_ms })
          : null,
    })
  if (input.type !== 'duel/received') return state
  const { duel } = state
  if (input.kind === 'invite')
    // one prompt at a time — a second suitor is silently outdrawn (theirs expires client-side)
    return duel.incoming && !duel_invite_expired(duel.incoming.at_ms, input.at_ms)
      ? state
      : with_duel(state, {
          ...duel,
          incoming: Object.freeze({ from: input.from, character: input.character, at_ms: input.at_ms }),
        })
  if (input.kind === 'accept' && duel.outgoing?.to === input.from)
    return with_duel(state, {
      ...duel,
      outgoing: null,
      // a late accept (past the TTL both prompts already dropped) is void — no transaction
      challenge: duel_invite_expired(duel.outgoing.at_ms, input.at_ms) ? null : Object.freeze({ to: input.from }),
    })
  if (input.kind === 'decline' && duel.outgoing?.to === input.from) return with_duel(state, { ...duel, outgoing: null })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state }) => {
  // BOTH handshake surfaces are top-right toasts (owner 2026-08-21: notifications are never
  // centered): the challenger waits on a pending toast with an inline cancel; the challenged
  // answers on an info toast with inline accept/decline. Each follows its state delta and
  // self-expires at TTL through the reducer door. `waiting.to` mirrors the shown toast for
  // the decline notice.
  const waiting: { to: string | null; dismiss: (() => void) | null; timer: ReturnType<typeof setTimeout> | null } = {
    to: null,
    dismiss: null,
    timer: null,
  }
  const prompt: { dismiss: (() => void) | null; timer: ReturnType<typeof setTimeout> | null } = {
    dismiss: null,
    timer: null,
  }
  /** the accepted handshake's own deadline — nothing else expires it, and the fold must stay
   *  clock-free (a streamed fight carries no timestamp of ours) */
  const accepted_timer: { id: ReturnType<typeof setTimeout> | null } = { id: null }
  const text = (key: string, values?: Readonly<Record<string, string>>) => {
    const { copy } = get_state()
    return copy ? copy_text(copy.world_hud)(key, values) : key
  }

  // wire → reducer door, timestamped at the edge
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/duel') return
    dispatch({
      type: 'duel/received',
      from: packet.from,
      character: packet.character,
      kind: packet.kind,
      at_ms: Date.now(),
    })
  })

  // the two outbound intents carry their target IN THE INPUT — never re-read from post-fold state
  events.on('duel/invited', ({ to }) => dispatch({ type: 'duel/signal', to, kind: 'invite' }))
  events.on('duel/answered', ({ accept, to }) =>
    dispatch({ type: 'duel/signal', to, kind: accept ? 'accept' : 'decline' })
  )

  // fires BEFORE the state delta clears the mirror — the one moment both facts are readable
  events.on('duel/received', ({ from, character, kind }) => {
    if (kind === 'decline' && waiting.to === from) toast.add(text('duel_declined', { name: character }), 'info')
  })

  // chain effects fire on OBSERVED DELTAS: the reducer decided validity; a pending appearing
  // is the one signal. Each effect clears its pending through the reducer door when it resolves.
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.duel === previous.duel) return

    // the waiting toast follows the outgoing invite's lifetime
    if (state.duel.outgoing !== previous.duel.outgoing) {
      waiting.dismiss?.()
      if (waiting.timer) clearTimeout(waiting.timer)
      waiting.to = state.duel.outgoing?.to ?? null
      waiting.dismiss = state.duel.outgoing
        ? toast.persistent(text('duel_waiting', { name: state.duel.outgoing.character }), 'pending', {
            label: text('duel_cancel'),
            onClick: () => dispatch({ type: 'duel/cleared' }),
          })
        : null
      // the TTL re-enters as an input — the store never keeps a timer
      waiting.timer = state.duel.outgoing
        ? setTimeout(() => dispatch({ type: 'duel/cleared' }), DUEL_INVITE_TTL_MS)
        : null
    }

    if (state.duel.accepted !== previous.duel.accepted) {
      if (accepted_timer.id) clearTimeout(accepted_timer.id)
      accepted_timer.id = state.duel.accepted
        ? setTimeout(() => dispatch({ type: 'duel/cleared' }), DUEL_INVITE_TTL_MS)
        : null
    }

    // WE ACCEPTED AND NO FIGHT CAME: the challenger's transaction failed, or a fight was born
    // somewhere we could not match it. The handshake dies on its TTL — say so instead of
    // leaving the player waiting on a duel that will never start.
    if (previous.duel.accepted && !state.duel.accepted && !state.duel.join)
      toast.add(text('duel_never_started'), 'info')

    // the challenge prompt follows the incoming invite's lifetime — accept/decline inline
    if (state.duel.incoming !== previous.duel.incoming) {
      prompt.dismiss?.()
      if (prompt.timer) clearTimeout(prompt.timer)
      const { incoming } = state.duel
      const answer = (accept: boolean) => () =>
        incoming && dispatch({ type: 'duel/answered', accept, to: incoming.from, at_ms: Date.now() })
      prompt.dismiss = incoming
        ? toast.persistent(
            text('duel_invite', { name: incoming.character }),
            'info',
            { label: text('duel_accept'), onClick: answer(true) },
            { label: text('duel_decline'), onClick: answer(false) }
          )
        : null
      prompt.timer = incoming ? setTimeout(() => dispatch({ type: 'duel/cleared' }), DUEL_INVITE_TTL_MS) : null
    }
    const { wallet, selected_character_id, characters } = state.session
    if (!wallet || !selected_character_id) return
    // custody rides the wire: the character row carries its holding kiosk + personal cap
    const row = characters.find(({ id }) => id === selected_character_id)
    const custody = row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined

    // THE CHALLENGER'S TURN: the accept arrived — create the fight at our own spot.
    if (state.duel.challenge && !previous.duel.challenge) {
      const pose = read_pose()
      dispatch({ type: 'duel/cleared' })
      if (!pose) {
        toast.add('no position — the duel was not created')
        return
      }
      // NEVER a decline on failure: the throw can land AFTER the chain committed, and telling
      // the peer "no" then leaves a real fight with our character sealed in it and nobody
      // coming (incident 2026-08-21). Their handshake expires on its own TTL. Nothing is sent
      // on success either — the indexer's zone fact is what calls them in.
      void wallet.fight
        .challenge_duel({
          character_id: selected_character_id,
          custody,
          x: Math.round(client_to_chain_coordinate(pose.x)),
          z: Math.round(client_to_chain_coordinate(pose.z)),
        })
        .catch((error: Error) => toast.add(error))
      return
    }

    // THE ACCEPTOR'S TURN: the fight exists — take the empty side (team B, group-sealed).
    if (state.duel.join && !previous.duel.join) {
      const { fight } = state.duel.join
      dispatch({ type: 'duel/cleared' })
      void wallet.fight
        .join({ fight, character_id: selected_character_id, custody, team: 1, access: 1 })
        .catch((error: Error) => toast.add(error))
    }
  })
}

export default Object.freeze({ name: 'duel', reduce: reduce_duel, observe }) satisfies AppModule
