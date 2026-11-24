// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, RunEnding } from '@aresrpg/protocol'

import { titleize } from '../content/titles.ts'
import { items_by_type } from '../content/items.ts'
import { copy_text, format_text, type AppCopy } from '../i18n/copy.ts'

import { hero_whereabouts, type HeroActivity, type HeroEvent, type RunPhase } from './activity.ts'

/** One line as the player reads it: what happened, its outcome under it, and whether the outcome is a problem. */
export type ActivityText = Readonly<{ action: string; result?: string; tone?: 'alert' }>
type Told<K extends HeroEvent['kind']> = (
  copy: AppCopy,
  event: Readonly<Extract<HeroEvent, { kind: K }>>,
  locale?: string
) => ActivityText

const ui_text = (copy: AppCopy, key: string): string => copy.ui[key] ?? ''
/** One sentence of the hosted-bot pages' own copy. */
export const agent_text = (copy: AppCopy, key: string, values: Readonly<Record<string, string>> = {}): string =>
  copy_text(copy.agent_page)(key, values)
/** Refusal codes become one plain sentence; an unexpected code never reaches the player raw. */
const agent_error = (copy: AppCopy, code: string): string =>
  copy.agent_page[`error_${code}`] ?? agent_text(copy, 'error_unknown')
const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? item_type
const said =
  (key: string): Told<HeroEvent['kind']> =>
  (copy) => ({ action: ui_text(copy, key) })

/** The run's own title, in its author's words; a run of a retired shape has none and reads "Activity". */
const run_title = (copy: AppCopy, title: string | null | undefined): string =>
  title || agent_text(copy, 'activity_other')
/** A run's state in words; a blocker is the one sentence of `run_notice`, and
 * a run that ended by itself the one sentence of its ending. */
const phase_text = (copy: AppCopy, phase: RunPhase, ending?: RunEnding): Pick<ActivityText, 'result' | 'tone'> => {
  if (phase === 'working') return { result: agent_text(copy, 'position_running') }
  if (phase === 'ended') return { result: agent_text(copy, ending ? `run_ended_${ending}` : 'position_finished') }
  return { result: agent_text(copy, `run_notice_${phase}`), tone: 'alert' }
}

/** One home for what each line says. Bot codes are looked up here and never printed. */
const TEXT: { readonly [K in HeroEvent['kind']]: Told<K> } = {
  level: (copy, { level }) => ({ action: format_text(ui_text(copy, 'agent_activity_level'), { level }) }),
  profession: said('agent_activity_profession'),
  travel: said('agent_activity_travel'),
  fight_entered: said('agent_activity_fight_entered'),
  fight_left: said('agent_activity_fight_left'),
  dungeon_left: said('agent_activity_dungeon_left'),
  experience: (copy, { gained }, locale) => ({
    action: agent_text(copy, 'position_xp'),
    result: `+${BigInt(gained).toLocaleString(locale)}`,
  }),
  dungeon: (copy, { dungeon, room }) => ({
    action: agent_text(copy, 'position_dungeon', { dungeon: titleize(dungeon), room: String(room) }),
  }),
  fight_won: (copy) => ({ action: copy.fight_hud.result_victory ?? '' }),
  fight_lost: (copy) => ({ action: copy.fight_hud.result_defeat ?? '' }),
  loot: (copy, { drops }) => ({
    action: ui_text(copy, 'agent_activity_loot'),
    result: drops.map(({ item_type, qty }) => `${qty} × ${item_name(item_type)}`).join(', '),
  }),
  run: (copy, { title, phase, ending }) => ({ action: run_title(copy, title), ...phase_text(copy, phase, ending) }),
  command: (copy, { error }) => ({
    action: ui_text(copy, 'agent_activity_command'),
    ...(error === null
      ? { result: agent_text(copy, 'position_finished') }
      : { result: agent_error(copy, error), tone: 'alert' }),
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
