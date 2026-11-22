// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Quest tab: fight for loot or go to work, send the heroes, and follow every hero that is out.
import { useState, type ReactNode } from 'react'
import { Button } from '@aresrpg/ui'
import type { CharacterRow } from '@aresrpg/protocol'
import { Pickaxe, Swords } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { bot_wait_key, dapp_text } from './copy.ts'
import { DappQuestFight } from './DappQuestFight.tsx'
import { pick_quest, useRunsInView, type QuestSend, type SendParts } from './DappQuestParts.tsx'
import { DappQuestWork } from './DappQuestWork.tsx'
import { DappRunCard } from './DappRunCard.tsx'
import { DappFeeCap, fee_valid } from './DappStartParts.tsx'
import type { DappPosition } from './positions.ts'
import { activity_offer, bot_unreachable, idle_heroes, type DappInput, type QuestPick } from './state.ts'
import type { Blocker, StartSpec } from './strategies.ts'
import { job_options } from './work.ts'

import './dapp_quest.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Offer = Readonly<ReturnType<typeof activity_offer>>

/** One Start of the Quest tab, exactly as the reducer takes it. */
export const start_input = (id: string, spec: StartSpec, title: string): DappInput => ({
  type: 'dapp/start',
  id,
  spec,
  title,
})
/**
 * The runs this tab follows: every run that is not a raid. `running` keeps the heroes that are out;
 * without it, the runs that ended and wait to be dismissed or sent again. The Raid tab follows its own.
 */
export const quest_runs = (positions: readonly DappPosition[], running: boolean): readonly DappPosition[] =>
  positions.filter(({ activity, finished_ms }) => activity !== 'raid' && (finished_ms === null) === running)

const BLOCKERS: readonly Blocker[] = [
  'hero_busy',
  'hero_unknown',
  'world_required',
  'key_missing',
  'work_unknown',
  'job_level_required',
  'tool_required',
]
const names_of = (heroes: readonly Hero[]): string => heroes.map(({ name }) => name).join(', ')
/** The one line about the bot itself: a start is being sent, or the bot has not answered, or it cannot be reached. */
const bot_line = (text: Text, sending: boolean, unanswered: boolean, unreachable: boolean) => {
  if (sending) return [{ key: 'waiting', line: text(bot_wait_key(false)) }]
  if (!unanswered) return []
  return [{ key: unreachable ? 'unreachable' : 'waiting', line: text(bot_wait_key(unreachable)) }]
}
/** Why a Start would leave heroes behind, one line per reason, and what the page still waits for. */
const send_lines = (text: Text, { free, sending, plan }: Offer, unreachable: boolean) => {
  const blocked = BLOCKERS.flatMap((blocker) => {
    const held = plan.blocked.filter((entry) => entry.blocker === blocker).map(({ hero_id }) => hero_id)
    const names = names_of(free.filter(({ id }) => held.includes(id)))
    return names ? [{ key: blocker, line: text(`blocker_${blocker}`, { names }) }] : []
  })
  // Free heroes with neither a tree nor a reason mean the bot itself has not answered yet.
  const unanswered = [free.length > 0, !plan.starts.length, !blocked.length].every(Boolean)
  return [
    ...blocked,
    ...bot_line(text, sending, unanswered, unreachable),
    ...(!free.length && !sending ? [{ key: 'idle', line: text('blocker_no_free_hero') }] : []),
  ]
}
/** The Start button names who goes on a fight quest; work has one worker, already named above it. */
const send_label = (text: Text, { activity }: StartSpec, { free, plan }: Offer): string => {
  if (!free.length) return text('quest_pick_hero')
  if (activity === 'gather') return text('work_start')
  const going = free.filter(({ id }) => plan.starts.some(({ hero_id }) => hero_id === id))
  return text('quest_send', { names: names_of(going.length ? going : free) })
}

/** A run with no goal of its own goes on until the player stops it: the Start says so as its tooltip. */
const endless = (spec: StartSpec): boolean => {
  if (spec.activity === 'train') return true
  if (spec.activity !== 'gather') return false
  return spec.work.mode === 'auto' || spec.work.goal.kind === 'until_stopped'
}

type SendProps = Readonly<{ copy: AppCopy; spec: StartSpec; title: string }> & SendParts
/**
 * What one Start would do, and the Start itself: the rows of the mode, the fee limit as one more row,
 * why a hero would stay behind, and one button with the link of the mode beside it. Nothing is sent
 * before that button. `entry` is the fee limit as typed.
 */
export const QuestSendView = ({
  copy,
  spec,
  title,
  rows,
  link,
  entry,
  enter,
}: SendProps & Readonly<{ entry: string | null; enter: (entry: string) => void }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const offer = activity_offer(dapp, account, spec, title)
  const cap = dapp.quest.fee_cap_mist
  return (
    <div className="dapp-quest-send" data-send={spec.activity}>
      <div className="dapp-quest-ledgers">
        {rows?.(offer.plan)}
        <DappFeeCap
          copy={copy}
          cap={cap}
          typed={entry}
          type={enter}
          pick={(fee_cap_mist) => pick_quest({ fee_cap_mist })}
        />
      </div>
      <ul className="dapp-quest-lines" aria-live="polite">
        {send_lines(text, offer, bot_unreachable(dapp)).map(({ key, line }) => (
          <li key={key} data-line={key}>
            {line}
          </li>
        ))}
      </ul>
      <div className="dapp-quest-foot">
        {link}
        {fee_valid(entry, cap) && (
          <Button
            tone="primary"
            busy={offer.sending}
            disabled={!offer.plan.starts.length}
            title={endless(spec) ? text('quest_until_stop') : undefined}
            data-start=""
            onClick={() => dispatch_app(start_input(crypto.randomUUID(), spec, title))}
          >
            {send_label(text, spec, offer)}
          </Button>
        )}
      </div>
    </div>
  )
}
/** The fee limit as typed is view state. Only a valid limit reaches the pick. */
const Send = (props: SendProps) => {
  const [entry, enter] = useState<string | null>(null)
  return <QuestSendView {...props} entry={entry} enter={enter} />
}

type Kind = QuestPick['kind']
const MODES: readonly Readonly<{ kind: Kind; icon: ReactNode }>[] = [
  { kind: 'fight', icon: <Swords size={22} aria-hidden="true" /> },
  { kind: 'work', icon: <Pickaxe size={22} aria-hidden="true" /> },
]
/** The best free worker and its real profession level; null while no free hero has learnt a profession. */
const top_worker = (heroes: readonly Hero[]) =>
  job_options(heroes)
    .flatMap(({ job, worker }) => (worker && worker.level > 1 ? [{ job, ...worker }] : []))
    .toSorted((left, right) => right.level - left.level)[0] ?? null

/** Fight or work: two cards sized to what they say. The work card names the best free worker by its real profession level. */
const ModeCards = ({ text, kind }: Readonly<{ text: Text; kind: Kind }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const { job: job_name } = useVocabulary()
  const best = top_worker(idle_heroes(dapp, account))
  const worker =
    best && `${best.hero.name} · ${text('work_job_level', { job: job_name(best.job), level: String(best.level) })}`
  return (
    <div className="dapp-quest-modes" role="group" aria-label={text('quest_title')}>
      {MODES.map((mode) => (
        <Button
          key={mode.kind}
          className="dapp-quest-card"
          aria-pressed={kind === mode.kind}
          data-mode={mode.kind}
          onClick={() => pick_quest({ kind: mode.kind })}
        >
          <span className="dapp-quest-card-icon">{mode.icon}</span>
          <span className="dapp-quest-card-text">
            <b>{text(`quest_${mode.kind}`)}</b>
            <small>{text(`quest_${mode.kind}_body`)}</small>
            {mode.kind === 'work' && worker && <small data-best-worker="">{worker}</small>}
          </span>
        </Button>
      ))}
    </div>
  )
}

/**
 * One card per run that is not a raid: the heroes that are out, then the runs that ended. A finished
 * card stays until dismissed and can send the same again. A group with no run is not drawn. A hero
 * that goes out brings the group into view: the answer to a Start is on screen.
 */
const Runs = ({
  copy,
  locale,
  title,
  running,
}: Readonly<{ copy: AppCopy; locale: Locale; title: string; running: boolean }>) => {
  const positions = useAppStore(({ dapp }) => dapp.positions)
  const runs = quest_runs(positions, running)
  const section = useRunsInView(running ? runs.length : 0)
  if (!runs.length) return null
  return (
    <section ref={section} className="dapp-section" aria-label={title} data-quest-runs={running ? 'out' : 'finished'}>
      <h2>{title}</h2>
      <div className="dapp-quest-runs">
        {runs.map((position) => (
          <DappRunCard key={position.id} copy={copy} locale={locale} position={position} />
        ))}
      </div>
    </section>
  )
}

/**
 * The Quest tab. The pick (`state.dapp.quest`) is the reducer's; each mode shows it, proposes the
 * heroes when none is picked, and hands its Start to the one `Send` of this tab once the player chose
 * what the plan is about. The heroes that are out stand first: a Start answers at the top of the tab,
 * above the setup of the next one.
 */
export const DappQuest = ({ copy, locale }: Readonly<{ copy: AppCopy; locale: Locale }>) => {
  const kind = useAppStore(({ dapp }) => dapp.quest.kind)
  const empty = useAppStore(({ session }) => session.agent_inventory.characters.length === 0)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const send: QuestSend = (spec, title, parts) => <Send copy={copy} spec={spec} title={title} {...parts} />
  const Mode = kind === 'fight' ? DappQuestFight : DappQuestWork
  return (
    <div className="dapp-quest" data-quest={kind}>
      <header className="dapp-quest-head">
        <h2>{text('quest_title')}</h2>
        <p className="dapp-note">{text('quest_intro')}</p>
      </header>
      <Runs copy={copy} locale={locale} title={text('out_now_title')} running />
      {empty ? (
        <div className="dapp-notice-row" data-quest-empty="">
          <p className="dapp-note">{text('quest_empty')}</p>
          <Button onClick={() => dispatch_app({ type: 'dapp/tab', tab: 'home' })}>{text('quest_empty_action')}</Button>
        </div>
      ) : (
        <>
          <ModeCards text={text} kind={kind} />
          <Mode copy={copy} locale={locale} send={send} />
        </>
      )}
      <Runs copy={copy} locale={locale} title={text('position_finished')} running={false} />
    </div>
  )
}
