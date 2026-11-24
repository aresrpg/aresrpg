// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The AI page's terminal: one translucent pane over the page's ground. Its top bar holds the agent's state and the
// heroes; its transcript shows, under the run each belongs to, what this open page saw the agent do; its last line
// is what the shown hero does now. It only shows: there is nothing to type.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Button, SegmentedControl } from '@aresrpg/ui'
import { ArrowDown, ChevronRight, CircleAlert, Hourglass, Lock, type LucideIcon } from 'lucide-react'
import type { AgentStatus, CharacterRow } from '@aresrpg/protocol'

import { character_icon, item_icon } from '../content/assets.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { subscribe_app, useSiteStore } from '../store.ts'
import { format_sui } from '../wallet_amount.ts'

import {
  fold_hero_logs,
  hero_activity,
  log_groups,
  observed_heroes,
  run_facts,
  type HeroLogs,
  type LogGroup,
  type LoggedEvent,
  type ObservedHeroes,
} from './activity.ts'
import {
  activity_text,
  agent_text,
  current_text,
  item_name,
  run_state,
  run_title,
  type ActivityHue,
  type ActivityText,
} from './activity_text.ts'
import type { AgentInventoryView } from './inventory_state.ts'
import './agent_log.css'

type Observed = Readonly<{ before: ObservedHeroes; after: ObservedHeroes; at: number }>
type Account = Readonly<Pick<AgentInventoryView, 'phase' | 'characters' | 'status'>>
const NO_LOGS: HeroLogs = Object.freeze({})
const reduce_logs = (logs: HeroLogs, { before, after, at }: Observed): HeroLogs =>
  fold_hero_logs(logs, before, after, at)

/**
 * The log lives with the open page and is stored nowhere. The store subscription is its one door:
 * each change of the observed account is folded once, by value, with the time the page saw it.
 */
const useHeroLogs = (): HeroLogs => {
  const [logs, observe] = useReducer(reduce_logs, NO_LOGS)
  useEffect(
    () =>
      subscribe_app(({ session: { agent_inventory: after } }, { session: { agent_inventory: before } }) => {
        if (after === before) return
        observe({ before: observed_heroes(before), after: observed_heroes(after), at: Date.now() })
      }),
    []
  )
  return logs
}

/** The hero the log shows: the one picked while the account still holds it, else the first. */
const shown_hero = (heroes: readonly CharacterRow[], picked: string | null): CharacterRow | null =>
  heroes.find(({ id }) => id === picked) ?? heroes[0] ?? null

/** Each colour family as the site's tokens draw it. */
const HUE: Readonly<Record<ActivityHue, string>> = {
  agent: 'text-orange',
  chain: 'text-sui',
  gain: 'text-success',
  loss: 'text-danger',
  gold: 'text-hue-gold',
  clay: 'text-(--aui-hue-clay)',
  sky: 'text-hue-sky',
  green: 'text-(--aui-hue-green)',
  dim: 'text-muted',
}

/** The agent's state as the site's status dot and one word. */
type WalletTone = 'ok' | 'warn' | 'down' | 'wait'
const DOT: Readonly<Record<WalletTone, string>> = {
  ok: 'bg-success',
  warn: 'bg-orange',
  down: 'bg-danger',
  wait: 'bg-steel',
}
const STATE_TONE: Readonly<Record<AgentStatus['state'], WalletTone>> = {
  idle: 'ok',
  active: 'ok',
  waiting: 'ok',
  awaiting_ai: 'warn',
  paused: 'warn',
  unavailable: 'down',
}
/** Before the account is read the dot waits; a bot that has not spoken yet is connected with no word. */
const wallet_state = (copy: AppCopy, { phase, status }: Account): Readonly<{ tone: WalletTone; word: string }> => {
  if (phase === 'failed') return { tone: 'down', word: agent_text(copy, 'state_failed') }
  if (phase !== 'ready') return { tone: 'wait', word: '' }
  if (!status) return { tone: 'ok', word: '' }
  const state = status.ready ? status.state : 'unavailable'
  return { tone: STATE_TONE[state], word: copy.ui[`agent_activity_${state}`] ?? '' }
}

/** Times keep one width in every language: a 24-hour clock with seconds, as a terminal prints it. */
const clock = (at: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(
    at
  )
const TIME = 'w-[8.5ch] shrink-0 text-gold tabular-nums'

/** What a hero does now, as a mark on its portrait so the tab keeps its width. */
const hero_option = (copy: AppCopy, status: AgentStatus | null) => (hero: Readonly<CharacterRow>) => {
  const { color_1, color_2, color_3 } = hero
  const portrait = character_icon(hero.classe, hero.sex, { color_1, color_2, color_3 })
  const now = current_text(copy, hero, status && hero_activity(status, hero.id))
  const Mark = now?.icon
  return {
    value: hero.id,
    label: `${hero.name} · ${agent_text(copy, 'hero_level', { level: String(hero.level) })}`,
    icon: (
      <span className="relative flex shrink-0">
        {portrait ? <img src={portrait} alt="" /> : <span className="size-[22px]" />}
        {Mark && now && (
          <span className="agent-hero-mark" title={now.action}>
            <Mark size={10} className={HUE[now.hue]} aria-hidden="true" />
            <span className="sr-only">{now.action}</span>
          </span>
        )}
      </span>
    ),
  }
}

const TopBar = ({
  copy,
  account,
  hero,
  pick,
}: Readonly<{ copy: AppCopy; account: Account; hero: CharacterRow | null; pick: (id: string) => void }>) => {
  const { tone, word } = wallet_state(copy, account)
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-5 gap-y-2 border-b border-hair px-4 py-2">
      <div className="mr-auto flex min-w-0 items-center gap-2.5">
        <span className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
        <h1 className="m-0 text-[14px] leading-snug font-semibold whitespace-nowrap text-text">
          {copy.ui.agent_connected}
        </h1>
        {word && <span className="min-w-0 truncate text-[12px] text-soft">· {word}</span>}
      </div>
      {hero ? (
        <div className="agent-heroes min-w-0">
          <SegmentedControl<string>
            label={agent_text(copy, 'heroes_title')}
            value={hero.id}
            on_change={pick}
            options={account.characters.map(hero_option(copy, account.status))}
          />
        </div>
      ) : (
        account.phase !== 'ready' &&
        account.phase !== 'failed' && <span className="aui-skeleton h-9 w-56" aria-hidden="true" />
      )}
    </header>
  )
}

/** The items a fight dropped, each with its icon and count. */
const Drops = ({ drops }: Readonly<{ drops: Extract<LoggedEvent['event'], { kind: 'loot' }>['drops'] }>) => (
  <ul className="agent-result m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
    {drops.map(({ item_type, qty }) => {
      const icon = item_icon(item_type)
      return (
        <li key={item_type} className="flex items-center gap-1.5 text-soft">
          {icon ? <img src={icon} alt="" className="size-5 [image-rendering:pixelated]" /> : null}
          <span className="text-hue-gold tabular-nums">{qty} ×</span>
          {item_name(item_type)}
        </li>
      )
    })}
  </ul>
)

/**
 * One line: its time, its mark, what happened, and the outcome under it after a connector. The line of what the
 * hero does now has no time and, while the hero is played, a cursor after its words.
 */
const Line = ({
  text: { action, result, tone, icon: Icon, hue },
  time,
  cursor = false,
  children,
}: Readonly<{ text: ActivityText; time: ReactNode; cursor?: boolean; children?: ReactNode }>) => (
  <li className="flex gap-3">
    <span className={TIME}>{time}</span>
    <Icon size={15} className={`mt-[3px] shrink-0 ${HUE[hue]}`} aria-hidden="true" />
    <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
      <p className="m-0 text-text">
        {action}
        {cursor && <span className="agent-cursor" aria-hidden="true" />}
      </p>
      {children ??
        (result && <p className={`agent-result m-0 ${tone === 'alert' ? 'text-danger' : 'text-soft'}`}>{result}</p>)}
    </div>
  </li>
)

const Lines = ({ copy, locale, lines }: Readonly<{ copy: AppCopy; locale: string; lines: readonly LoggedEvent[] }>) => (
  <ol className="m-0 grid list-none gap-2 p-0">
    {lines.map(({ id, at, event }) => (
      <Line key={id} text={activity_text(copy, event, locale)} time={clock(at, locale)}>
        {event.kind === 'loot' ? <Drops drops={event.drops} /> : undefined}
      </Line>
    ))}
  </ol>
)

/** What a run has spent and played since its tree was set, as the bot tells it while the run plays. */
const RunTally = ({
  copy,
  locale,
  run,
}: Readonly<{ copy: AppCopy; locale: string; run: AgentStatus['runs'][number] }>) => (
  <span className="ml-auto flex shrink-0 flex-wrap gap-x-3 text-[12px] text-soft">
    {run.fees_mist !== undefined && (
      <span className="text-sui">
        {agent_text(copy, 'run_fees', { amount: format_sui(BigInt(run.fees_mist), 4, locale) })}
      </span>
    )}
    {!!run.dungeon_runs && <span>{agent_text(copy, 'run_dungeons', { count: String(run.dungeon_runs) })}</span>}
  </span>
)

/** A run's lines under its title and state, folded open; a line seen outside any run stands alone. */
const Group = ({
  copy,
  locale,
  group: { run, lines },
  status,
}: Readonly<{ copy: AppCopy; locale: string; group: LogGroup; status: AgentStatus | null }>) => {
  if (!run) return <Lines copy={copy} locale={locale} lines={lines} />
  const { word, icon: Icon, hue } = run_state(copy, run)
  const told = run.phase === 'ended' ? undefined : status?.runs.find(({ id }) => id === run.id)
  return (
    <details open className="agent-run">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-[3px] py-0.5">
        <span className={`${TIME} flex items-center`}>
          <ChevronRight size={14} className="agent-run-chevron text-muted" aria-hidden="true" />
        </span>
        <Icon size={15} className={`shrink-0 ${HUE[hue]}`} aria-hidden="true" />
        <span className="min-w-0 font-semibold text-text [overflow-wrap:anywhere]">{run_title(copy, run.title)}</span>
        <span className={`text-[12px] ${HUE[hue]}`}>{word}</span>
        {told && <RunTally copy={copy} locale={locale} run={told} />}
      </summary>
      {lines.length > 0 && (
        <div className="agent-run-body mt-2">
          <Lines copy={copy} locale={locale} lines={lines} />
        </div>
      )}
    </details>
  )
}

/** A short note in the transcript's own voice: a state of the log, never a line of history. */
const Note = ({
  icon: Icon,
  title,
  body,
  alert = false,
}: Readonly<{
  icon: LucideIcon
  title: string
  body?: string
  alert?: boolean
}>) => (
  <div className="flex gap-3" role={alert ? 'alert' : undefined}>
    <span className={TIME} />
    <Icon size={15} className={`mt-[3px] shrink-0 ${alert ? 'text-danger' : 'text-muted'}`} aria-hidden="true" />
    <div className="min-w-0">
      <p className={`m-0 ${alert ? 'text-danger' : 'text-soft'}`}>{title}</p>
      {body && <p className="m-0 text-muted">{body}</p>}
    </div>
  </div>
)

/** The transcript keeps to its newest line unless the reader scrolled up; then a control brings it back. */
const usePinnedScroll = (content: string) => {
  const box = useRef<HTMLDivElement>(null)
  const [away, set_away] = useState(false)
  useLayoutEffect(() => {
    if (!away) box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [content, away])
  const follow = () => {
    const node = box.current
    if (node) set_away(node.scrollHeight - node.scrollTop - node.clientHeight > 24)
  }
  const jump = () => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  }
  return { box, away, follow, jump }
}

/** The shown hero's runs and lines, then what it does now with a cursor while it is played. */
const HeroTranscript = ({
  copy,
  locale,
  hero,
  lines,
  status,
}: Readonly<{
  copy: AppCopy
  locale: string
  hero: CharacterRow
  lines: readonly LoggedEvent[]
  status: AgentStatus | null
}>) => {
  const groups = log_groups(lines, status?.ready ? run_facts(status, hero.id) : null)
  const now = current_text(copy, hero, status && hero_activity(status, hero.id))
  const { box, away, follow, jump } = usePinnedScroll(`${lines.length}:${now?.action}:${now?.result}`)
  return (
    <div className="agent-transcript relative min-h-0 flex-1">
      <div
        ref={box}
        onScroll={follow}
        className="agent-scroll grid h-full content-start gap-3 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-label={`${copy.ui.agent_activity_label} · ${hero.name}`}
        // The transcript scrolls inside the page: `tabIndex` lets the keyboard reach it and scroll it.
        tabIndex={0}
      >
        {groups.map((group) => (
          <Group
            key={group.run?.id ?? `line-${group.lines[0]?.id}`}
            copy={copy}
            locale={locale}
            group={group}
            status={status}
          />
        ))}
        {lines.length === 0 && (
          <Note
            icon={Hourglass}
            title={agent_text(copy, 'log_waiting_title')}
            body={agent_text(copy, 'log_waiting_body')}
          />
        )}
        {now && (
          <ol className="agent-now m-0 list-none p-0">
            <Line text={now} time="" cursor={now.acting} />
          </ol>
        )}
      </div>
      {away && (
        <Button className="agent-jump absolute right-4 bottom-3" onClick={jump}>
          <ArrowDown size={14} aria-hidden="true" />
          {agent_text(copy, 'jump_latest')}
        </Button>
      )}
    </div>
  )
}

/** The transcript's box before a hero can be shown: loading, a failed read, or a bot that holds no hero. */
const NoHero = ({ copy, phase }: Readonly<{ copy: AppCopy; phase: AgentInventoryView['phase'] }>) => (
  <div className="agent-transcript grid min-h-0 flex-1 content-start gap-3 px-4 py-4">
    {phase === 'failed' && <Note icon={CircleAlert} title={agent_text(copy, 'heroes_failed')} alert />}
    {phase === 'ready' && (
      <Note icon={Hourglass} title={agent_text(copy, 'empty_title')} body={agent_text(copy, 'empty_body')} />
    )}
    {phase !== 'ready' && phase !== 'failed' && (
      <div className="grid gap-3" aria-busy="true">
        <span className="aui-skeleton h-4 w-2/5" />
        <span className="aui-skeleton h-4 w-3/5" />
        <span className="aui-skeleton h-4 w-1/3" />
      </div>
    )}
  </div>
)

/** The connected page's terminal: the bot account's heroes and the log this open page has kept of each. */
export const AgentLog = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const account = useSiteStore(({ session }) => session.agent_inventory)
  const locale = useSiteStore((state) => state.locale)
  const logs = useHeroLogs()
  const [picked, pick] = useState<string | null>(null)
  const hero = shown_hero(account.characters, picked)
  return (
    <section className="agent-glass flex h-[clamp(440px,70dvh,1040px)] min-w-0 flex-col overflow-hidden rounded-[7px] font-mono text-[13px] leading-[1.6]">
      <TopBar copy={copy} account={account} hero={hero} pick={pick} />
      {hero ? (
        <HeroTranscript
          key={hero.id}
          copy={copy}
          locale={locale}
          hero={hero}
          lines={logs[hero.id] ?? []}
          status={account.status}
        />
      ) : (
        <NoHero copy={copy} phase={account.phase} />
      )}
      <footer className="flex items-center gap-2 border-t border-hair px-4 py-2 text-[12px] text-muted">
        <Lock size={12} aria-hidden="true" />
        <span className="font-ui">{copy.ui.agent_log_read_only}</span>
      </footer>
    </section>
  )
}
