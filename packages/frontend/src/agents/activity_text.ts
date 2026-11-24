// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Bot,
  Castle,
  ChevronsUp,
  CircleAlert,
  CircleCheck,
  CircleStop,
  DoorOpen,
  FlaskConical,
  Footprints,
  Gem,
  HandCoins,
  Hammer,
  Hourglass,
  LogOut,
  MapPin,
  Moon,
  PackageOpen,
  Pause,
  Pickaxe,
  Play,
  Search,
  Shirt,
  ShoppingCart,
  Skull,
  Sparkles,
  SquareTerminal,
  Swords,
  Tag,
  TrendingUp,
  Trophy,
  Undo2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { CharacterRow } from '@aresrpg/protocol'

import { titleize } from '../content/titles.ts'
import { items_by_type } from '../content/items.ts'
import { copy_text, format_text, type AppCopy } from '../i18n/copy.ts'

import { hero_whereabouts, type HeroActivity, type HeroEvent, type RunHead, type RunPhase } from './activity.ts'

/**
 * The colour family of a line: `agent` is what the agent did, `chain` anything on chain or in SUI, `gain` and `loss`
 * an outcome, the hues a kind of play, and `dim` what only closes something.
 */
export type ActivityHue = 'agent' | 'chain' | 'gain' | 'loss' | 'gold' | 'clay' | 'sky' | 'green' | 'dim'
type Look = Readonly<{ icon: LucideIcon; hue: ActivityHue }>
/** One line as the player reads it: what happened, its outcome under it, whether the outcome is a problem, and its mark. */
export type ActivityText = Look & Readonly<{ action: string; result?: string; tone?: 'alert' }>
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
export const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? item_type
const said =
  (key: string, look: Look): Told<HeroEvent['kind']> =>
  (copy) => ({ action: ui_text(copy, key), ...look })

/** The run's own title, in its author's words; a run of a retired shape has none and reads "Activity". */
export const run_title = (copy: AppCopy, title: string | null | undefined): string =>
  title || agent_text(copy, 'activity_other')
/** A run's state in words; a blocker is the one sentence of `run_notice`, and
 * a run that ended by itself the one sentence of its ending. */
const phase_text = (
  copy: AppCopy,
  phase: RunPhase,
  ending?: RunHead['ending']
): Pick<ActivityText, 'result' | 'tone'> => {
  if (phase === 'working') return { result: agent_text(copy, 'position_running') }
  if (phase === 'ended') return { result: agent_text(copy, ending ? `run_ended_${ending}` : 'run_state_stopped') }
  return { result: agent_text(copy, `run_notice_${phase}`), tone: 'alert' }
}
/** A run's state as one word and its mark: it plays, it needs the player, it ended by itself, or it was stopped. */
export const run_state = (
  copy: AppCopy,
  { phase, ending }: Pick<RunHead, 'phase' | 'ending'>
): Look & Readonly<{ word: string }> => {
  if (phase === 'working') return { word: agent_text(copy, 'position_running'), icon: Play, hue: 'agent' }
  if (phase !== 'ended') return { word: agent_text(copy, 'run_state_blocked'), icon: CircleAlert, hue: 'loss' }
  return ending
    ? { word: agent_text(copy, 'position_finished'), icon: CircleCheck, hue: 'gain' }
    : { word: agent_text(copy, 'run_state_stopped'), icon: CircleStop, hue: 'dim' }
}

/**
 * The bot's actions a direct command names, each with its own words. Several actions of one kind share them;
 * an action absent here reads as a plain request of the assistant, so a new one never reaches the player raw.
 */
type Command = Readonly<{ key: string } & Look>
const FIGHT: Command = { key: 'command_fight', icon: Swords, hue: 'agent' }
const COMMANDS: Readonly<Record<string, Command>> = Object.freeze({
  market_sell: { key: 'command_market_sell', icon: Tag, hue: 'chain' },
  market_buy: { key: 'command_market_buy', icon: ShoppingCart, hue: 'chain' },
  market_delist: { key: 'command_market_delist', icon: Undo2, hue: 'chain' },
  market_collect: { key: 'command_market_collect', icon: HandCoins, hue: 'chain' },
  gather: { key: 'command_gather', icon: Pickaxe, hue: 'agent' },
  craft: { key: 'command_craft', icon: Hammer, hue: 'agent' },
  equip_item: { key: 'command_equip', icon: Shirt, hue: 'agent' },
  equip_tool: { key: 'command_equip', icon: Shirt, hue: 'agent' },
  open_loot_boxes: { key: 'command_loot', icon: PackageOpen, hue: 'agent' },
  claim_loot: { key: 'command_loot', icon: PackageOpen, hue: 'agent' },
  use_consumable: { key: 'command_consumable', icon: FlaskConical, hue: 'agent' },
  raise_stats: { key: 'command_points', icon: ChevronsUp, hue: 'agent' },
  raise_spell: { key: 'command_points', icon: ChevronsUp, hue: 'agent' },
  create_character: { key: 'command_create', icon: UserPlus, hue: 'agent' },
  world_search: { key: 'command_search', icon: Search, hue: 'agent' },
  dungeon_enter: { key: 'command_dungeon', icon: Castle, hue: 'agent' },
  dungeon_leave: { key: 'command_dungeon', icon: Castle, hue: 'agent' },
  ...Object.fromEntries(
    [
      'dungeon_fight',
      'resolve_ambush',
      'fight_engage',
      'fight_join',
      'fight_start',
      'fight_place',
      'fight_ready',
      'fight_turn',
      'fight_crank',
      'fight_forfeit',
      'fight_settle',
    ].map((action) => [action, FIGHT])
  ),
})
const command_look = (copy: AppCopy, action: string): Pick<ActivityText, 'action' | 'icon' | 'hue'> => {
  const known = Object.hasOwn(COMMANDS, action) ? COMMANDS[action]! : null
  return known
    ? { action: agent_text(copy, known.key), icon: known.icon, hue: known.hue }
    : { action: ui_text(copy, 'agent_activity_command'), icon: SquareTerminal, hue: 'agent' }
}

/** One home for what each line says and how it is marked. Bot codes are looked up here and never printed. */
const TEXT: { readonly [K in HeroEvent['kind']]: Told<K> } = {
  level: (copy, { level }) => ({
    action: format_text(ui_text(copy, 'agent_activity_level'), { level }),
    icon: Sparkles,
    hue: 'gold',
  }),
  profession: said('agent_activity_profession', { icon: Pickaxe, hue: 'green' }),
  travel: said('agent_activity_travel', { icon: Footprints, hue: 'sky' }),
  fight_entered: said('agent_activity_fight_entered', { icon: Swords, hue: 'agent' }),
  fight_left: said('agent_activity_fight_left', { icon: DoorOpen, hue: 'dim' }),
  dungeon_left: said('agent_activity_dungeon_left', { icon: LogOut, hue: 'dim' }),
  experience: (copy, { gained }, locale) => ({
    action: agent_text(copy, 'position_xp'),
    result: `+${BigInt(gained).toLocaleString(locale)}`,
    icon: TrendingUp,
    hue: 'gain',
  }),
  dungeon: (copy, { dungeon, room }) => ({
    action: agent_text(copy, 'position_dungeon', { dungeon: titleize(dungeon), room: String(room) }),
    icon: Castle,
    hue: 'clay',
  }),
  fight_won: (copy) => ({ action: copy.fight_hud.result_victory ?? '', icon: Trophy, hue: 'gain' }),
  fight_lost: (copy) => ({ action: copy.fight_hud.result_defeat ?? '', icon: Skull, hue: 'loss' }),
  loot: (copy, { drops }) => ({
    action: ui_text(copy, 'agent_activity_loot'),
    result: drops.map(({ item_type, qty }) => `${qty} × ${item_name(item_type)}`).join(', '),
    icon: Gem,
    hue: 'gold',
  }),
  run: (copy, { title, phase, ending }) => {
    const { icon, hue } = run_state(copy, { phase, ending })
    return { action: run_title(copy, title), ...phase_text(copy, phase, ending), icon, hue }
  },
  command: (copy, { action, error }) => ({
    ...command_look(copy, action),
    ...(error === null
      ? { result: agent_text(copy, 'position_finished') }
      : { result: agent_error(copy, error), tone: 'alert', hue: 'loss' }),
  }),
}

export const activity_text = (copy: AppCopy, event: HeroEvent, locale?: string): ActivityText =>
  (TEXT[event.kind] as Told<HeroEvent['kind']>)(copy, event, locale)

/** What a hero can be doing now, each with its mark. A fight or a dungeon is play the hero is in. */
const NOW = Object.freeze({
  fight: { icon: Swords, hue: 'agent' },
  dungeon: { icon: Castle, hue: 'agent' },
  world: { icon: MapPin, hue: 'dim' },
  active: { icon: Play, hue: 'agent' },
  waiting: { icon: Hourglass, hue: 'agent' },
  awaiting_ai: { icon: Bot, hue: 'gold' },
  paused: { icon: Pause, hue: 'gold' },
  unavailable: { icon: CircleAlert, hue: 'loss' },
  idle: { icon: Moon, hue: 'dim' },
} satisfies Readonly<Record<string, Look>>)
/** The mark of what a hero does now: a place from its chain row or the bot's word for it. */
export const now_mark = (state: keyof typeof NOW): Look => NOW[state]!
/** States in which the bot is playing the hero right now. */
const PLAYING: readonly string[] = ['active', 'waiting']
const ACTING: readonly string[] = ['fight', 'dungeon', ...PLAYING]

/**
 * What a hero does right now, never a line of history. A fight or a dungeon the hero is in says the most while the
 * bot plays it or has not spoken; otherwise the bot's word for the hero, else where its chain row places it. A run's
 * blocker is its one sentence under it. `acting` is true while the hero is being played.
 */
export const current_text = (
  copy: AppCopy,
  hero: Readonly<CharacterRow>,
  activity: HeroActivity | null
): (ActivityText & Readonly<{ acting: boolean }>) | null => {
  const place = hero_whereabouts(hero)
  const state = activity?.status ?? null
  const in_play = (place === 'fight' || place === 'dungeon') && (state === null || PLAYING.includes(state))
  const shown = in_play ? place : (state ?? place)
  if (!shown) return null
  const notice = activity?.notice
  return {
    action: ui_text(copy, `agent_activity_${shown}`),
    ...(notice ? { result: agent_text(copy, `run_notice_${notice}`), tone: 'alert' as const } : {}),
    ...NOW[shown],
    acting: ACTING.includes(shown) && !notice,
  }
}
