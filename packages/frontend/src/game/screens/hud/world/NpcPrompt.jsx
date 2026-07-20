// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WS-B — the lobby NPC proximity affordance. The roam scene dispatches `action/npc_prompt` when the
// avatar walks within range of the Dungeon Master (and null when it leaves); this SOURCE registers the
// "[E] enter the dungeons" prompt into the PROMPT STACK (S-18 pick: all proximity prompts render together
// in one bottom-center vertical stack — PromptStack.jsx owns render + keys; this component renders nothing)
// and opens the dungeon browser/create modal shell when the stack fires E (or the pill is clicked).
// The modal's on-chain browse/create is WS-C's.

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { use_game_state, context } from '../../../store.js'
import { push_event_toast } from '../../../core/toast.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { use_prompt_stack } from '../../../../world-shell/prompt_stack.js'

/** @returns {import('react').ReactElement | null} */
export function NpcPrompt() {
  const { t } = useTranslation()
  const prompt = use_game_state((s) => s.npc_prompt)
  const modal_open = use_game_state((s) => s.dungeons_modal)
  const fight_mode = use_game_state((s) => s.fight_mode)
  // The SELECTED character — the one the NPC interaction would actually act on — gates the prompt: a
  // character already out exploring (staked) or escrowed in ANOTHER dungeon can't enter a new one
  // (dungeon::join_dungeon MoveAborts, kiosk::borrow_val: not in the kiosk). `null` (nothing selected yet)
  // never gates — there's nothing to be honest ABOUT.
  const character = use_game_state((s) => s.sui.characters.find((c) => c.id === s.selected_character_id))
  // AMENDMENT: the RESUME/ABANDON stuck panel is DELETED —
  // a seated character NEVER sees the lobby (boot/join auto-enter the cave via cave_session); LEAVE
  // DUNGEON in-cave is the single exit. If auto-enter fails, the gate below fails LOUD with a toast.
  const active = !!prompt && !modal_open && !fight_mode

  // Owner invariant (verbatim): "if we are in a dungeon, then we should be in it, not in the world." A selected
  // char that's in_dungeon is NOT a dead end — pressing E RESUMES that dungeon (resume_dungeon attaches to a
  // live run, or on a terminal/stuck one runs the boot-rescue claim → unescrow → roster refresh, no reload).
  // Only `exploring` (staked) stays an honest block — a different, legitimate state (staking gates entry there).
  const resume_target = character?.in_dungeon && character?.dungeon_id ? character : null
  const gate_label = character?.exploring ? t('dungeons.gate_exploring') : null

  // #3 NO DEAD CLICK: a busy character must NEVER silently no-op — either resume the live dungeon, open the real
  // flow, or say exactly why not (the exploring toast).
  const enter = () => {
    if (resume_target) {
      // user:true — a stale run (burned/unseated) recovers INTO the fresh-enter flow (D288), never a dead click.
      void use_dungeon.getState().resume_dungeon(resume_target.dungeon_id, resume_target.id, { user: true })
      return
    }
    if (gate_label) {
      push_event_toast({ state: 'error', title: gate_label })
      return
    }
    context.dispatch('action/dungeons_modal', true)
  }

  // Register/refresh the [E] prompt in the stack while live; clear it the moment the signal dies.
  // Canon copy (optionB-lobby.png): "[E] ENTER THE DUNGEONS" — the stack's kbd renders "E" as its own
  // pill; the label carries the rest verbatim. A busy selected character swaps the CTA for the honest
  // reason (gw-npc-prompt--busy variant), never a dead click.
  useEffect(() => {
    const { register_prompt, clear_prompt } = use_prompt_stack.getState()
    if (!active) {
      clear_prompt('dungeon')
      return
    }
    register_prompt({
      id: 'dungeon',
      key: 'E',
      label: resume_target ? t('dungeons.state_resume') : (gate_label ?? t('dungeons.enter')),
      mobile_label: resume_target ? t('dungeons.state_resume') : (gate_label ?? t('dungeons.enter_touch')),
      priority: 100, // an NPC you walked up to — the most-actionable anchor
      busy: !!gate_label,
      on_trigger: enter,
    })
    return () => use_prompt_stack.getState().clear_prompt('dungeon')
  }, [active, gate_label, resume_target?.dungeon_id, resume_target?.id, t])

  return null
}
