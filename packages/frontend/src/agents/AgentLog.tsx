// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useReducer, useState } from 'react'
import { SegmentedControl } from '@aresrpg/ui'
import type { AgentStatus, CharacterRow } from '@aresrpg/protocol'

import { character_icon } from '../content/assets.ts'
import { dapp_text } from '../dapp/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { subscribe_app, useAppStore } from '../store.ts'

import {
  fold_hero_logs,
  hero_activity,
  observed_heroes,
  type HeroLogs,
  type LoggedEvent,
  type ObservedHeroes,
} from './activity.ts'
import { activity_text, current_text, pending_text, type ActivityText } from './activity_text.ts'
import type { AgentInventoryView } from './inventory_state.ts'
import './agent_log.css'

type Observed = Readonly<{ before: ObservedHeroes; after: ObservedHeroes; at: number }>
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
export const shown_hero = (heroes: readonly CharacterRow[], picked: string | null): CharacterRow | null =>
  heroes.find(({ id }) => id === picked) ?? heroes[0] ?? null

const clock = (at: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at)

/** One line: its time, what happened, and the outcome indented under it. The line in progress has no time yet. */
const LogRow = ({
  text: { action, result, tone },
  locale,
  at = null,
}: Readonly<{ text: ActivityText; locale: string; at?: number | null }>) => (
  <div className="agent-log-row" aria-current={at === null || undefined}>
    {at !== null && <time dateTime={new Date(at).toISOString()}>{clock(at, locale)}</time>}
    <p className="agent-log-action">
      {action}
      {at === null && <span className="agent-log-cursor" aria-hidden="true" />}
    </p>
    {result && (
      <p className="agent-log-result" data-tone={tone}>
        {result}
      </p>
    )}
  </div>
)

/** What the agent did with one hero, oldest first, then what the hero does right now. */
const HeroLog = ({
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
  const now = current_text(copy, hero, status && hero_activity(status, hero.id))
  return (
    // The log scrolls inside the page: `tabIndex` lets the keyboard reach it and scroll it.
    <div
      className="agent-log"
      role="log"
      aria-live="polite"
      aria-label={`${copy.ui.agent_activity_label} · ${hero.name}`}
      tabIndex={0}
    >
      <div className="agent-log-rows">
        {lines.map(({ id, at, event }) => (
          <LogRow key={id} at={at} locale={locale} text={activity_text(copy, event, locale)} />
        ))}
        {now && <LogRow locale={locale} text={now} />}
      </div>
    </div>
  )
}

/** The account has no hero to show: the wait is named, a failure is said, an empty account says what to do. */
const HeroesWait = ({ copy, phase }: Readonly<{ copy: AppCopy; phase: AgentInventoryView['phase'] }>) => {
  if (phase === 'failed')
    return (
      <p className="agent-log-wait" role="alert">
        {dapp_text(copy, 'heroes_failed')}
      </p>
    )
  if (phase !== 'ready')
    return (
      <p className="agent-log-wait" role="status" aria-busy="true">
        <span className="aui-spinner" aria-hidden="true" />
        {dapp_text(copy, 'reading_heroes')}
      </p>
    )
  return (
    <div className="agent-log-empty">
      <p>{dapp_text(copy, 'empty_title')}</p>
      <p>{dapp_text(copy, 'empty_body')}</p>
    </div>
  )
}

const hero_option = (copy: AppCopy) => (hero: Readonly<CharacterRow>) => {
  const { color_1, color_2, color_3 } = hero
  const portrait = character_icon(hero.classe, hero.sex, { color_1, color_2, color_3 })
  return {
    value: hero.id,
    label: `${hero.name} · ${dapp_text(copy, 'hero_level', { level: String(hero.level) })}`,
    icon: portrait ? <img src={portrait} alt="" /> : undefined,
  }
}

type LogProps = Readonly<{
  copy: AppCopy
  locale: string
  account: Readonly<Pick<AgentInventoryView, 'phase' | 'characters' | 'status'>>
  logs: HeroLogs
  picked: string | null
  pick: (hero_id: string) => void
}>
/** One control per hero the bot account holds, the picked hero's log, and the line that says the page only shows. */
export const AgentLogView = ({ copy, locale, account, logs, picked, pick }: LogProps) => {
  const { phase, characters: heroes, status } = account
  const hero = shown_hero(heroes, picked)
  return (
    <>
      {hero ? (
        <>
          <div className="agent-log-heroes">
            <SegmentedControl<string>
              label={dapp_text(copy, 'heroes_title')}
              value={hero.id}
              on_change={pick}
              options={heroes.map(hero_option(copy))}
            />
          </div>
          <HeroLog copy={copy} locale={locale} hero={hero} lines={logs[hero.id] ?? []} status={status} />
        </>
      ) : (
        <HeroesWait copy={copy} phase={phase} />
      )}
      {hero && phase === 'failed' && (
        <p className="agent-log-wait" role="alert">
          {dapp_text(copy, 'heroes_failed')}
        </p>
      )}
      <p className="agent-log-note">{pending_text(copy, 'agent_log_read_only')}</p>
    </>
  )
}

/** The connected page's content: the bot account's heroes and the log this open page has kept of each. */
export const AgentLog = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const locale = useAppStore((state) => state.locale)
  const logs = useHeroLogs()
  const [picked, pick] = useState<string | null>(null)
  return <AgentLogView copy={copy} locale={locale} account={account} logs={logs} picked={picked} pick={pick} />
}
