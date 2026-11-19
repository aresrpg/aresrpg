// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import type { BotResult } from '@aresrpg/protocol/hosted-bot-client'
import { run_live, type StrategyArea } from '@aresrpg/protocol/strategies'

import type { Copy, CopyKey } from './copy.ts'
import type { Action, Hero, View } from './hosted.ts'
import { bind_hero, strategies } from './strategies.ts'
import { button, card, type Card } from './transport.ts'
import type { Input } from './wire.ts'

/** The strategy card a player may approve: what it showed, kept until the very next update. */
type Review = Readonly<{ strategy: string; area: StrategyArea; replaces: boolean; expires: number }>
/** Everything Telegram keeps for one sender, in process memory. The hosted bot owns every run. */
export type Session = Readonly<{
  /** Every update takes the next revision, so a button acts only as the next update after its card. */
  revision: number
  /** The login this state belongs to; another login starts over. */
  binding: string | null
  character: string | null
  review: Review | null
}>
export const initial_session = (): Session => ({ revision: 0, binding: null, character: null, review: null })
/** What one update decides: a card to show, requests to send to the hosted bot, or a refusal by its code. */
export type Step = Readonly<
  { session: Session } & ({ card: Card } | { actions: readonly Action[] } | { refused: string })
>

type Options = Readonly<{ copy: Copy; now: number; review_ttl_ms: number }>
type Base = Options & Readonly<{ previous: Session; session: Session; argument: string; view: View }>
type Context = Base & NonNullable<View['roster']>

const character_key = (id: string) => createHash('sha256').update(id).digest('base64url')
const navigation = (copy: Copy) => [[button(copy.back, '/menu'), button(copy.status, '/status')]]
const refuse = (session: Session, refused: string): Step => ({ session, refused })

const RUN_STATES: ReadonlyMap<unknown, CopyKey> = new Map([
  ['active', 'strategy_active'],
  ['waiting', 'strategy_waiting'],
  ['completed', 'completed'],
  ['stopped', 'stopped'],
  ['failed', 'attention'],
  ['awaiting_ai', 'attention'],
])
const state_name = (status: unknown, copy: Copy) => copy[RUN_STATES.get(status) ?? 'observation_unknown']
/** The heroes whose run holds them: a new tree for one of them replaces its run. */
const live_runs = ({ runs }: View) => Object.keys(runs).filter((id) => run_live(runs[id]!))
const hero_name = ({ heroes, copy }: Context, id: string) =>
  heroes.find((hero) => hero.id === id)?.name ?? copy.observation_unknown
const selected_hero = ({ heroes, session }: Context) =>
  heroes.find(({ id, usable }) => id === session.character && usable)

/** Every run the wallet hosts, one line per hero: the status of the whole agent in one message. */
const status_lines = (context: Context) => {
  const { view, copy } = context
  // A run is named by the catalogue entry it was bound from. An authored tree, or an entry Telegram does
  // not offer, was started from another client: it is listed all the same, under one generic label.
  const strategy_name = (id: string | null) =>
    strategies.some((offered) => offered.id === id) ? copy.strategies[id!]! : copy.external_strategy
  const running = Object.entries(view.runs).map(([id, { status, strategy }]) =>
    [hero_name(context, id), strategy_name(strategy), state_name(status, copy)].join(' · ')
  )
  return [
    `${copy.balance}: ${view.balance ?? copy.observation_unknown}`,
    ...(running.length ? running : [copy.no_strategy]),
  ]
}
/** Status and navigation in one message: the balance, the runs, then the heroes to choose from. */
const menu = (context: Context): Step => {
  const { session, heroes, copy } = context
  const selected = heroes.find(({ id }) => id === session.character)
  const live = live_runs(context.view)
  // A hero with a run shows its state in the list above, not a second time on its button.
  const label = ({ id, name, activity }: Hero) =>
    live.includes(id) && activity === 'idle' ? name : `${name} · ${copy[activity]}`
  const lines = [...status_lines(context), heroes.length ? copy.menu : copy.empty, ...(selected ? [selected.name] : [])]
  return {
    session: { ...session, character: selected?.id ?? null },
    card: card(lines.join('\n'), [
      ...heroes.map((hero) => [button(label(hero), `select:${session.revision}:${character_key(hero.id)}`)]),
      [button(copy.status, '/status'), button(copy.inventory, '/inventory')],
      ...(live.length ? [[button(copy.stop, '/stop')]] : []),
      ...(selected?.usable ? [[button(copy.play, `play:${session.revision}`)]] : []),
    ]),
  }
}
const select = (context: Context): Step => {
  const hero = context.heroes.find(({ id }) => character_key(id) === context.argument)
  return hero
    ? menu({ ...context, session: { ...context.session, character: hero.id } })
    : refuse(context.session, 'character_changed')
}
const play = (context: Context): Step => {
  const { session, copy } = context
  const hero = selected_hero(context)
  if (!hero) return menu(context)
  return {
    session,
    card: card(`${hero.name}\n${copy.choose_strategy}`, [
      ...strategies.map(({ id }) => [button(copy.strategies[id]!, `strategy:${session.revision}:${id}`)]),
      ...navigation(copy),
    ]),
  }
}
/** The review names the hero, the fixed scope, a replacement and the ongoing costs before anything is sent. */
const strategy = (context: Context): Step => {
  const { session, view, copy, argument } = context
  const hero = selected_hero(context)
  if (!hero) return refuse(session, 'character_changed')
  const bound = bind_hero(argument, hero.row, copy.strategies[argument] ?? argument)
  if (!bound.ok) return refuse(session, bound.error)
  const { area } = bound.value
  const replaces = live_runs(view).includes(hero.id)
  const [scope, effects] = area.city
    ? [copy.city_review.replace('{city}', area.city), copy.effects]
    : [copy.world_review.replace('{world}', area.world), copy.gather_effects]
  const lines = [
    copy.review,
    `${hero.name} · ${copy.strategies[argument]}`,
    scope,
    ...(replaces ? [copy.replace_strategy] : []),
    effects,
  ]
  return {
    session: {
      ...session,
      review: { strategy: argument, area, replaces, expires: context.now + context.review_ttl_ms },
    },
    card: card(lines.join('\n'), [[button(copy.approve, `approve:${session.revision}`)], ...navigation(copy)]),
  }
}
/** Approval binds the tree again from this update's observation and sends it only if the hero still stands
 * in the reviewed area and the card's start or replacement still holds. */
const approve = (context: Context): Step => {
  const { session, view, copy, revisions } = context
  const { review } = context.previous
  if (!review || review.expires <= context.now) return refuse(session, 'review_expired')
  const hero = selected_hero(context)
  if (!hero) return refuse(session, 'character_changed')
  const title = copy.strategies[review.strategy]!
  const bound = bind_hero(review.strategy, hero.row, title)
  if (!bound.ok) return refuse(session, bound.error)
  const { script, area } = bound.value
  const replaces = live_runs(view).includes(hero.id)
  const reviewed = [area.world === review.area.world, area.city === review.area.city, replaces === review.replaces]
  if (!reviewed.every(Boolean)) return refuse(session, 'review_changed')
  const request = { script, revisions, subject: `${hero.name} · ${title}` }
  return {
    session,
    actions: [replaces ? { type: 'replace', character: hero.id, ...request } : { type: 'start', ...request }],
  }
}
/** Stop is chosen per hero on one card; the choice is then confirmed on its own card, like Pause. */
const stop_card = (context: Context): Step => {
  const { session, view, copy } = context
  const live = live_runs(view)
  if (!live.length) return menu(context)
  return {
    session,
    card: card(`${copy.stop}\n${copy.stop_scope}`, [
      ...live.map((id) => [button(hero_name(context, id), `stop:${session.revision}:${character_key(id)}`)]),
      ...(live.length > 1 ? [[button(copy.stop_all, `stop:${session.revision}:all`)]] : []),
      ...navigation(copy),
    ]),
  }
}
const stop_targets = ({ view, argument }: Context): readonly string[] =>
  live_runs(view).filter((id) => argument === 'all' || character_key(id) === argument)
/** Choosing who stops sends nothing: the card names them and asks once. */
const stop = (context: Context): Step => {
  const { session, copy, argument } = context
  const names = stop_targets(context).map((id) => hero_name(context, id))
  if (!names.length) return refuse(session, 'behavior_run_not_found')
  return {
    session,
    card: card(`${copy.stop} · ${names.join(', ')}\n${copy.stop_scope}`, [
      [button(copy.approve, `halt:${session.revision}:${argument}`)],
      ...navigation(copy),
    ]),
  }
}
const halt = (context: Context): Step => {
  const targets = stop_targets(context)
  const { session } = context
  return targets.length
    ? { session, actions: targets.map((id) => ({ type: 'stop', character: id, subject: hero_name(context, id) })) }
    : refuse(session, 'behavior_run_not_found')
}
/** Pause and Resume act on the whole wallet, other connectors included, so each is confirmed on its own card. */
const control_card =
  (kind: 'pause' | 'resume') =>
  ({ session, copy }: Base): Step => ({
    session,
    card: card(`${copy[kind]}\n${copy.wallet_scope}`, [
      [button(copy.approve, `${kind}:${session.revision}`)],
      ...navigation(copy),
    ]),
  })

// Telegram sendMessage's documented text limit after entity parsing; this is not an inventory cap.
const MESSAGE_CHARACTERS = 4096
const inventory = ({ session, view, copy, argument }: Context): Step => {
  const { items } = view
  if (!items?.length)
    return {
      session,
      card: card(`${copy.inventory} · ${items ? copy.inventory_empty : copy.observation_unknown}`, navigation(copy)),
    }
  const lines = items.map(
    (item) =>
      `${typeof item.name === 'string' && item.name ? item.name : String(item.item_type ?? '?')} × ${String(item.amount ?? '?')}`
  )
  const pages = lines.reduce<readonly string[]>(
    (pages, line) => {
      const combined = `${pages.at(-1)!}\n${line}`
      return combined.length <= MESSAGE_CHARACTERS
        ? [...pages.slice(0, -1), combined]
        : [...pages, `${copy.inventory}\n${line}`]
    },
    [copy.inventory]
  )
  const page = Number(argument)
  if (page >= pages.length) return refuse(session, 'inventory_page_expired')
  const turn = [
    ...(page > 0 ? [button('←', `inventory:${page - 1}`)] : []),
    ...(page + 1 < pages.length ? [button('→', `inventory:${page + 1}`)] : []),
  ]
  return {
    session,
    card: card(
      pages[page]!,
      [turn, ...navigation(copy)].filter((row) => row.length)
    ),
  }
}

/** The pause brake never waits for the roster. */
const ANYTIME = {
  pause_card: control_card('pause'),
  pause: ({ session }: Base): Step => ({ session, actions: [{ type: 'pause', subject: '' }] }),
}
const ROSTER = {
  menu,
  select,
  play,
  strategy,
  approve,
  stop_card,
  stop,
  halt,
  inventory,
  resume_card: control_card('resume'),
  resume: ({ session, revisions }: Context): Step => ({
    session,
    actions: [{ type: 'resume', revisions, subject: '' }],
  }),
}
type Intent = Readonly<{
  action: keyof typeof ANYTIME | keyof typeof ROSTER
  revision: number | null
  argument: string
}>
const COMMANDS: ReadonlyMap<string, Intent['action']> = new Map([
  ['/play', 'play'],
  ['/stop', 'stop_card'],
  ['/pause', 'pause_card'],
  ['/resume', 'resume_card'],
  ['/inventory', 'inventory'],
])
/** A button carries the revision of its card. Any other text, a typed command included, only navigates. */
const intent_of = (text: string): Intent => {
  const callback = /^(select|play|strategy|approve|stop|halt|pause|resume):(\d+)(?::([A-Za-z0-9_-]+))?$/.exec(text)
  if (callback)
    return { action: callback[1] as Intent['action'], revision: Number(callback[2]), argument: callback[3] ?? '' }
  const page = /^inventory:(\d+)$/.exec(text)
  return { action: page ? 'inventory' : (COMMANDS.get(text) ?? 'menu'), revision: null, argument: page?.[1] ?? '' }
}

/** The one reducer of a sender's state: the previous session, one update and what the bot reports now. */
export const reduce_companion = (previous: Session, input: Input, view: View, options: Options): Step => {
  const same_login = view.binding === previous.binding
  const session: Session = {
    revision: previous.revision + 1,
    binding: view.binding,
    character: same_login ? previous.character : null,
    review: null,
  }
  const intent = intent_of(input.text)
  const current = [Boolean(input.callback_id), intent.revision === previous.revision, same_login].every(Boolean)
  if (intent.revision !== null && !current) return refuse(session, 'action_expired')
  const base: Base = { ...options, previous, session, argument: intent.argument, view }
  if (intent.action === 'pause_card' || intent.action === 'pause') return ANYTIME[intent.action](base)
  if (!view.roster) return { session, card: card(options.copy.loading, navigation(options.copy)) }
  return ROSTER[intent.action]({ ...base, ...view.roster })
}

const CONFIRMED: Readonly<
  Record<Action['type'], (value: Readonly<Record<string, unknown>>, copy: Copy) => string | null>
> = {
  start: ({ status }, copy) => state_name(status, copy),
  replace: ({ status }, copy) => state_name(status, copy),
  stop: ({ status }, copy) => (status === 'stopped' ? copy.stopped : null),
  pause: ({ paused }, copy) => (paused === true ? copy.paused : null),
  resume: ({ paused }, copy) => (paused === false ? copy.resumed : null),
}
/** What one settled request tells the player. Only the bot's own confirmation is success; anything else keeps its code. */
export const outcome = (
  action: Action,
  result: BotResult<Readonly<Record<string, unknown>>>,
  copy: Copy
): BotResult<string> => {
  if (!result.ok) return result
  const confirmed = CONFIRMED[action.type](result.value, copy)
  if (confirmed === null) return { ok: false, error: 'control_unconfirmed' }
  return { ok: true, value: [action.subject, confirmed].filter(Boolean).join(' · ') }
}
export const outcome_card = (lines: readonly string[], copy: Copy) => card(lines.join('\n'), navigation(copy))
