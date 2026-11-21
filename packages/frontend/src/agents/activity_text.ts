// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, RunEnding } from '@aresrpg/protocol'

import { titleize } from '../content/catalog.ts'
import { dapp_error, dapp_text, item_name } from '../dapp/copy.ts'
import { format_text, type AppCopy } from '../i18n/copy.ts'

import { hero_whereabouts, type HeroActivity, type HeroEvent, type RunPhase } from './activity.ts'

/**
 * PENDING LOCALE KEYS. English fallbacks for `ui` keys the locale files do not hold yet. A key added
 * to the locales wins at once; when all four are there, delete this table and read `copy.ui` directly.
 */
const PENDING_COPY = Object.freeze({
  agent_activity_dungeon_left: 'Left the dungeon',
  agent_activity_loot: 'Loot',
  agent_activity_command: 'Action asked by your assistant',
  agent_log_read_only: 'Read only. Your AI assistant decides what happens here.',
})
export const pending_text = (copy: AppCopy, key: keyof typeof PENDING_COPY): string => copy.ui[key] ?? PENDING_COPY[key]

/** One line as the player reads it: what happened, its outcome under it, and whether the outcome is a problem. */
export type ActivityText = Readonly<{ action: string; result?: string; tone?: 'alert' }>
type Told<K extends HeroEvent['kind']> = (
  copy: AppCopy,
  event: Readonly<Extract<HeroEvent, { kind: K }>>,
  locale?: string
) => ActivityText

const ui_text = (copy: AppCopy, key: string): string => copy.ui[key] ?? ''
const said =
  (key: string): Told<HeroEvent['kind']> =>
  (copy) => ({ action: ui_text(copy, key) })

/** The run's own title, in its author's words; a run of a retired shape has none and reads "Activity". */
const run_title = (copy: AppCopy, title: string | null | undefined): string =>
  title || dapp_text(copy, 'activity_other')
/** A run's state in the words the dapp uses for it; a blocker is the one sentence of `run_notice`, and
 * a run that ended by itself the one sentence of its ending. */
const phase_text = (copy: AppCopy, phase: RunPhase, ending?: RunEnding): Pick<ActivityText, 'result' | 'tone'> => {
  if (phase === 'working') return { result: dapp_text(copy, 'position_running') }
  if (phase === 'ended') return { result: dapp_text(copy, ending ? `run_ended_${ending}` : 'position_finished') }
  return { result: dapp_text(copy, `run_notice_${phase}`), tone: 'alert' }
}

/** One home for what each line says. Bot codes are looked up here and never printed. */
const TEXT: { readonly [K in HeroEvent['kind']]: Told<K> } = {
  level: (copy, { level }) => ({ action: format_text(ui_text(copy, 'agent_activity_level'), { level }) }),
  profession: said('agent_activity_profession'),
  travel: said('agent_activity_travel'),
  fight_entered: said('agent_activity_fight_entered'),
  fight_left: said('agent_activity_fight_left'),
  dungeon_left: (copy) => ({ action: pending_text(copy, 'agent_activity_dungeon_left') }),
  experience: (copy, { gained }, locale) => ({
    action: dapp_text(copy, 'position_xp'),
    result: `+${BigInt(gained).toLocaleString(locale)}`,
  }),
  dungeon: (copy, { dungeon, room }) => ({
    action: dapp_text(copy, 'position_dungeon', { dungeon: titleize(dungeon), room: String(room) }),
  }),
  fight_won: (copy) => ({ action: copy.fight_hud.result_victory ?? '' }),
  fight_lost: (copy) => ({ action: copy.fight_hud.result_defeat ?? '' }),
  loot: (copy, { drops }) => ({
    action: pending_text(copy, 'agent_activity_loot'),
    result: drops.map(({ item_type, qty }) => `${qty} × ${item_name(item_type)}`).join(', '),
  }),
  run: (copy, { title, phase, ending }) => ({ action: run_title(copy, title), ...phase_text(copy, phase, ending) }),
  command: (copy, { error }) => ({
    action: pending_text(copy, 'agent_activity_command'),
    ...(error === null
      ? { result: dapp_text(copy, 'position_finished') }
      : { result: dapp_error(copy, error), tone: 'alert' }),
  }),
}

export const activity_text = (copy: AppCopy, event: HeroEvent, locale?: string): ActivityText =>
  (TEXT[event.kind] as Told<HeroEvent['kind']>)(copy, event, locale)

/**
 * What a hero does right now, never a line of history: the bot's word for it, else where its chain row
 * places it. A hero with a run reads the run's title, with its state or its one blocker sentence under it.
 */
export const current_text = (
  copy: AppCopy,
  hero: Readonly<CharacterRow>,
  activity: HeroActivity | null
): ActivityText | null => {
  const state = activity?.status ?? hero_whereabouts(hero)
  if (!state) return null
  const label = ui_text(copy, `agent_activity_${state}`)
  // `notice` is set, to a blocker or to null, only for a hero with a run.
  if (activity?.notice === undefined) return { action: label }
  const told = activity.notice ? phase_text(copy, activity.notice) : { result: label }
  return { action: run_title(copy, activity.objective?.title), ...told }
}
