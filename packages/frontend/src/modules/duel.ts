// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE DUEL — two transactions and no negotiation. The challenge itself opens the fight and
// RESERVES side B for the challenged character (fight.move ACCESS_INVITED), so the chain, not
// a peer's word, decides whose duel a fight is. The invitation is therefore not a message: it
// is the fight row already streaming to everyone nearby, carrying `opener_b`. A player whose
// own character is named there is being challenged — read, never received.
//
// This module holds NO state. The prompt is derived from the world's live fights, the answer
// is one transaction, and a refusal is remembered only for as long as the tab lives (a
// declined fight expires on its own placement window; the challenger leaves from his board).
// The whole invite/accept/decline relay, its TTL timers and its position matching are gone —
// they existed only because the chain had no target concept (incident 2026-08-22).

import type { FightRow } from '@aresrpg/protocol'
import { client_to_chain_coordinate } from '@aresrpg/immutable'

import type { AppModule, AppState } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { toast } from '../toast.ts'

import { selected_character } from './session.ts'

export type DuelInput = Readonly<{ type: 'duel/challenged'; character_id: string; name: string }>

export const duel_accept_was_canceled = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /abort code:\s*1706/i.test(message) && message.includes('::fight::jg')
}

/** The fights whose reserved seat names OUR character — the invitations, as a derivation. */
export const duels_awaiting = (state: AppState): readonly FightRow[] => {
  const own = state.session.selected_character_id
  if (!own) return []
  return Object.values(state.world.fights).filter((fight) => fight.phase === 'placement' && fight.opener_b === own)
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  /** answered invitations — tab-local machinery, never state: a declined fight keeps streaming
   *  until its window closes, and one refusal must not re-open the prompt on every tick */
  const answered = new Set<string>()
  const shown = new Map<string, () => void>()
  const text = (key: string, values?: Readonly<Record<string, string>>) => {
    const { copy } = get_state()
    return copy ? copy_text(copy.world_hud)(key, values) : key
  }

  const custody_of = (state: AppState) => {
    const row = selected_character(state.session)
    return row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined
  }

  // THE CHALLENGER: one transaction, no waiting. The fight is born at our proven spot with
  // their seat reserved; our own board opens from the seat we just took (fight.ts mounts it).
  events.on('duel/challenged', ({ character_id, name }) => {
    const state = get_state()
    const { wallet, selected_character_id } = state.session
    if (!wallet || !selected_character_id) return
    const pose = read_pose()
    if (!pose) {
      toast.add(text('duel_no_position'))
      return
    }
    toast.add(text('duel_challenging', { name }), 'info')
    void wallet.fight
      .challenge_duel({
        character_id: selected_character_id,
        target: character_id,
        custody: custody_of(state),
        x: Math.round(client_to_chain_coordinate(pose.x)),
        z: Math.round(client_to_chain_coordinate(pose.z)),
      })
      .then(({ fight }) => dispatch({ type: 'fight/watch', fight }))
      .catch((error: unknown) => toast.add(error))
  })

  // THE CHALLENGED: the invitation is a fight in the world, so the prompt follows the id SET —
  // it survives a reconnect, it cannot arrive twice, and it dies when the fight leaves.
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.world.fights === previous.world.fights && state.session === previous.session) return
    const live = new Set(duels_awaiting(state).map(({ id }) => id))
    for (const [fight, dismiss] of shown)
      if (!live.has(fight)) {
        dismiss()
        shown.delete(fight)
      }
    for (const fight of duels_awaiting(state)) {
      if (shown.has(fight.id) || answered.has(fight.id)) continue
      const challenger = Object.values(state.world.players).find(({ character_id }) => character_id === fight.opener_a)
      const answer = (accept: boolean) => () => {
        answered.add(fight.id)
        shown.get(fight.id)?.()
        shown.delete(fight.id)
        if (!accept) return
        const current = get_state()
        const { wallet, selected_character_id } = current.session
        if (!wallet || !selected_character_id) return
        dispatch({ type: 'fight/watch', fight: fight.id })
        void wallet.fight
          .join({
            fight: fight.id,
            character_id: selected_character_id,
            custody: custody_of(current),
            team: 1,
            access: 1,
          })
          .catch((error: unknown) => {
            dispatch({ type: 'fight/watch', fight: null })
            if (!duel_accept_was_canceled(error)) {
              toast.add(error)
              return
            }
            toast.add(
              text('duel_canceled_afraid', {
                name: challenger?.name ?? text('duel_unknown_challenger'),
              }),
              'info'
            )
          })
      }
      shown.set(
        fight.id,
        toast.persistent(
          text('duel_invite', { name: challenger?.name ?? text('duel_unknown_challenger') }),
          'info',
          { label: text('duel_accept'), onClick: answer(true) },
          { label: text('duel_decline'), onClick: answer(false) }
        )
      )
    }
  })
}

// the no-op reduce keeps the MODULES union uniform: this domain owns no state at all
export default Object.freeze({ name: 'duel', reduce: (state: AppState) => state, observe }) satisfies AppModule
