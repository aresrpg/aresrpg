// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { Button, Panel } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { titleize } from '../content/catalog.ts'

import { fight_mates } from './account.ts'
import { dapp_text, fees_paid } from './copy.ts'
import { HeroHealth, HeroPortrait, useClock } from './DappHeroCard.tsx'
import { DappItemRow, DappItemSheet } from './DappItemSheet.tsx'
import { open_market } from './DappMarketLink.tsx'
import type { DappPosition, FightResult } from './positions.ts'
import { hero_command, send_again } from './state.ts'

import './dapp_parts.css'

/** Drop rows a card lists, newest first. The card stays one screen tall on a phone; the bag holds the rest. */
export const RUN_DROPS_SHOWN = 6

type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Tone = 'live' | 'alert' | undefined
type RunStatus = Readonly<{ tone: Tone; label: string; reason: string | null }>

/**
 * What a run is doing, as one short label and, when there is one, the sentence that explains it. A
 * run that ended by itself says why, a blocked run names the help it needs and a waiting run names
 * what it waits for. The bot's own codes stay diagnostic (`data-issue`): none of them is ever text.
 */
const run_status = ({ finished_ms, ended, notice, wait }: DappPosition, stopping: boolean): RunStatus => {
  if (ended) return { tone: undefined, label: 'position_finished', reason: `run_ended_${ended}` }
  if (finished_ms !== null && notice)
    return { tone: 'alert', label: 'position_finished', reason: 'position_ended_issue' }
  if (finished_ms !== null) return { tone: undefined, label: 'position_finished', reason: null }
  if (stopping) return { tone: 'live', label: 'position_stopping', reason: null }
  if (notice) return { tone: 'alert', label: 'run_needs_help', reason: `run_notice_${notice}` }
  if (wait) return { tone: undefined, label: 'run_waiting', reason: `run_wait_${wait}` }
  return { tone: 'live', label: 'position_running', reason: null }
}

const unit = (locale: Locale, value: number, name: 'hour' | 'minute'): string =>
  new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value)
const duration = (locale: Locale, ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  return minutes >= 60
    ? `${unit(locale, Math.floor(minutes / 60), 'hour')} ${unit(locale, minutes % 60, 'minute')}`
    : unit(locale, minutes, 'minute')
}

/** The activity as the page names it; a run bound outside the shared catalogue is a plain "Activity". */
const activity_title = (text: Text, { activity }: Pick<DappPosition, 'activity'>): string =>
  text(`activity_${activity ?? 'other'}`)

type Hero = Readonly<CharacterRow>
/** Who is out, on what, and for how long. The clock ticks here alone, so a second redraws one line. */
const Head = ({
  text,
  locale,
  position,
  hero,
  status,
}: Readonly<{ text: Text; locale: Locale; position: DappPosition; hero: Hero | null; status: RunStatus }>) => {
  const { started_ms, finished_ms } = position
  const now = useClock(finished_ms === null)
  return (
    <header className="dapp-run-head">
      {hero && <HeroPortrait hero={hero} small />}
      <div className="dapp-run-title">
        <h3>{[activity_title(text, position), hero?.name].filter(Boolean).join(' · ')}</h3>
        <span className="dapp-run-status" aria-live="polite">
          <i className="dapp-dot" data-tone={status.tone} aria-hidden="true" />
          {text(status.label)}
        </span>
      </div>
      <span className="dapp-run-time">{duration(locale, (finished_ms ?? now) - started_ms)}</span>
    </header>
  )
}

/** Where the hero is right now, from its own chain row: its health, dungeon room and who shares its fight. */
const Whereabouts = ({ copy, hero }: Readonly<{ copy: AppCopy; hero: Hero }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const mates = fight_mates(heroes, hero.id)
    .map(({ name }) => name)
    .join(', ')
  const run = hero.dungeon_run
  return (
    <>
      <HeroHealth copy={copy} hero={hero} />
      {run && (
        <p className="dapp-run-line">
          {dapp_text(copy, 'position_dungeon', { dungeon: titleize(run.dungeon), room: String(run.room) })}
        </p>
      )}
      {mates && <p className="dapp-run-line">{dapp_text(copy, 'position_team', { names: mates })}</p>}
    </>
  )
}

/** What the run won and what it cost, as the page counted it and as the bot last said. Every figure is measured. */
const Facts = ({ text, locale, position }: Readonly<{ text: Text; locale: Locale; position: DappPosition }>) => {
  const { totals, dungeon_runs, fees_mist, activity } = position
  const told = totals.won.length + totals.lost.length > 0
  const raided = dungeon_runs !== null && (activity === 'raid' || dungeon_runs > 0)
  return (
    <>
      <dl className="dapp-run-facts">
        <div>
          <dt>{text('position_xp')}</dt>
          <dd>
            +{totals.xp.toLocaleString(locale)}
            {totals.levels > 0 && <small>{text('position_levels', { count: String(totals.levels) })}</small>}
          </dd>
        </div>
        <div>
          <dt>{text('position_job_xp')}</dt>
          <dd>+{totals.job_xp.toLocaleString(locale)}</dd>
        </div>
        <div>
          <dt>{text('position_fights')}</dt>
          <dd>
            {totals.fights.length}
            {told && (
              <small>{text('run_results', { won: String(totals.won.length), lost: String(totals.lost.length) })}</small>
            )}
          </dd>
        </div>
        {raided && (
          <div>
            <dt>{text('run_dungeon_runs')}</dt>
            <dd>{dungeon_runs}</dd>
          </div>
        )}
      </dl>
      {fees_mist !== null && (
        <p className="dapp-run-line" data-run-fees="">
          {text('fees_run', { amount: fees_paid(locale, fees_mist) })}
        </p>
      )}
    </>
  )
}

type Drop = Readonly<{ key: string; item_type: string; qty: number }>
/** The loot of the latest fights, newest first. */
const latest_drops = (results: readonly FightResult[]): readonly Drop[] =>
  results
    .toReversed()
    .flatMap(({ fight, drops }) =>
      drops.map(({ item_type, qty }) => ({ key: `${fight}:${item_type}`, item_type, qty }))
    )
    .slice(0, RUN_DROPS_SHOWN)

/**
 * What the latest fights dropped. It is in the bag already; selling it happens on the Market tab. A
 * finished run that dropped nothing has nothing to say here.
 */
const Drops = ({
  text,
  position: { results, finished_ms },
  inspect,
}: Readonly<{ text: Text; position: DappPosition; inspect: (item_type: string) => void }>) => {
  const drops = latest_drops(results)
  if (finished_ms !== null && !drops.length) return null
  return (
    <section className="dapp-run-drops">
      <header>
        <h4>{text('run_drops_title')}</h4>
        {drops.length > 0 && <Button onClick={() => open_market('SELL')}>{text('sell_loot')}</Button>}
      </header>
      {drops.length === 0 ? (
        <p className="dapp-run-line">{text('run_drops_empty')}</p>
      ) : (
        <ul className="dapp-rows">
          {drops.map(({ key, item_type, qty }) => (
            <li key={key}>
              <DappItemRow item_type={item_type} value={`×${qty}`} open={() => inspect(item_type)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A running hero has one Stop of its own. A finished card stays until dismissed, and can send the same again. */
const Actions = ({ text, position }: Readonly<{ text: Text; position: DappPosition }>) => {
  const { hero_id, sent } = position
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const command = hero_command(dapp, hero_id)
  if (position.finished_ms === null)
    return (
      <Button
        busy={command?.kind === 'stop'}
        disabled={command !== null}
        onClick={() => dispatch_app({ type: 'dapp/stop', id: crypto.randomUUID(), hero_ids: [hero_id] })}
      >
        {text('position_stop')}
      </Button>
    )
  const again = send_again(dapp, account, position, activity_title(text, position))
  return (
    <>
      <Button onClick={() => dispatch_app({ type: 'dapp/dismiss', position_id: position.id })}>
        {text('position_dismiss')}
      </Button>
      {sent && again && (
        <Button
          tone="primary"
          disabled={!again.ready}
          onClick={() => dispatch_app({ type: 'dapp/start', id: crypto.randomUUID(), spec: sent, title: again.title })}
        >
          {text('run_send_again')}
        </Button>
      )}
    </>
  )
}

/**
 * One hosted hero: what it does, why it waits, where it is, what it won and what it paid. Every
 * number is counted by this page or told by the bot; none is an estimate.
 */
export const DappRunCard = ({
  copy,
  locale,
  position,
}: Readonly<{ copy: AppCopy; locale: Locale; position: DappPosition }>) => {
  const { hero_id, finished_ms, objective } = position
  const hero = useAppStore(({ session }) => session.agent_inventory.characters.find(({ id }) => id === hero_id) ?? null)
  const stopping = useAppStore(({ dapp }) => hero_command(dapp, hero_id)?.kind === 'stop')
  const [inspected, inspect] = useState<string | null>(null)
  const running = finished_ms === null
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const status = run_status(position, stopping)
  return (
    <Panel className="dapp-run" data-run={hero_id} data-running={running || undefined} data-issue={position.issue}>
      <Head text={text} locale={locale} position={position} hero={hero} status={status} />
      {status.reason && (
        <p className="dapp-run-line" data-tone={status.tone} role="status">
          {text(status.reason)}
        </p>
      )}
      {objective && <p className="dapp-run-line">{text('run_objective', { objective })}</p>}
      {running && hero && <Whereabouts copy={copy} hero={hero} />}
      <Facts text={text} locale={locale} position={position} />
      <Drops text={text} position={position} inspect={inspect} />
      <footer className="dapp-run-foot">
        <Actions text={text} position={position} />
      </footer>
      {inspected && (
        <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: inspected }} close={() => inspect(null)} />
      )}
    </Panel>
  )
}
