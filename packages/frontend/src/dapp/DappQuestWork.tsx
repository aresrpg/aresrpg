// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Go to work: one hero, the way it works, and what it works on. Nothing about a work shows before the
// player picks it: the plan of the pick (`DappQuestWorkPlan`) opens beside the list it was picked from.
import { useState, type ReactNode } from 'react'
import { Button, Panel } from '@aresrpg/ui'
import { job_slugs } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { Bot, Hammer, Sprout } from 'lucide-react'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'

import { job_level } from './account.ts'
import { dapp_text, item_name } from './copy.ts'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { pick_quest, QuestSplit, usePlanInView, type QuestSend } from './DappQuestParts.tsx'
import { AutoPlan, ItemPlan, kept_goal, run_title, type ItemWork, type JobName } from './DappQuestWorkPlan.tsx'
import { work_spec, work_worker } from './state.ts'
import type { WorkPick } from './strategies.ts'
import { recipe_rows, resource_rows, work_job } from './work.ts'

import './dapp_quest.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Mode = WorkPick['mode']

/** The profession a hero is highest in; the first one for a hero new to all of them. */
const top_job = (hero: Hero): string =>
  job_slugs.toSorted((left, right) => job_level(hero, right) - job_level(hero, left))[0]!
/**
 * Whether the pick already says what to do. The reducer starts from the bot's own pick of any
 * profession: that one is nobody's choice yet, so nothing is planned from it until the player says so.
 */
const pick_said = (work: WorkPick): boolean => work.mode !== 'auto' || work.job !== null

/** One profession among all: the one the bot stays in, or the one whose recipes show. */
const JobChips = ({
  text,
  job_name,
  any,
  chosen,
  choose,
}: Readonly<{
  text: Text
  job_name: JobName
  /** Whether "any profession" is a choice. */
  any: boolean
  chosen: string | null
  choose: (job: string | null) => void
}>) => (
  <div className="dapp-quest-chips" role="group" aria-label={text('work_job')}>
    {any && (
      <Button aria-pressed={chosen === null} data-job="" onClick={() => choose(null)}>
        {text('work_job_any')}
      </Button>
    )}
    {job_slugs.map((job) => (
      <Button key={job} aria-pressed={chosen === job} data-job={job} onClick={() => choose(job)}>
        {job_name(job)}
      </Button>
    ))}
  </div>
)

type Choice = Readonly<{ item_type: string; job: string; required_level: number }>
/** One resource or one recipe to choose. One whose level the worker has not reached cannot be chosen. */
const ItemCard = ({
  text,
  row: { item_type, job, required_level },
  worker,
  pressed,
  job_name,
  choose,
}: Readonly<{
  text: Text
  row: Choice
  worker: Hero
  pressed: boolean
  job_name: JobName
  choose: (item_type: string) => void
}>) => {
  const locked = job_level(worker, job) < required_level
  const icon = item_icon(item_type)
  return (
    <Button
      className="dapp-quest-item"
      aria-pressed={pressed}
      disabled={locked}
      data-work-item={item_type}
      onClick={() => choose(item_type)}
    >
      {icon && <img src={icon} alt="" />}
      <b>{item_name(item_type)}</b>
      <small>
        {text(locked ? 'work_locked' : 'work_job_level', { job: job_name(job), level: String(required_level) })}
      </small>
    </Button>
  )
}

const JOBS = 'jobs'
const item_key = (item_type: string): string => `item:${item_type}`
type Listing = Readonly<{
  text: Text
  work: WorkPick
  worker: Hero
  job_name: JobName
  /** The profession whose recipes show, and how the player shows another. */
  shown: string | null
  show: (job: string | null) => void
}>
type Listed = Readonly<{
  entries: readonly Readonly<{ key: string; node: ReactNode }>[]
  chosen: string | null
  hint: string
}>
const chosen_item = (work: WorkPick, mode: Mode): string | null =>
  work.mode !== 'auto' && work.mode === mode ? item_key(work.item_type) : null
const item_entries = (
  { text, work, worker, job_name }: Listing,
  mode: ItemWork['mode'],
  rows: readonly Choice[]
): Listed['entries'] =>
  rows.map((row) => ({
    key: item_key(row.item_type),
    node: (
      <ItemCard
        text={text}
        row={row}
        worker={worker}
        pressed={chosen_item(work, mode) === item_key(row.item_type)}
        job_name={job_name}
        choose={(item_type) => pick_quest({ work: { mode, item_type, goal: kept_goal(work) } })}
      />
    ),
  }))
/**
 * What each way of working chooses from. The bot's own pick stays in any profession or in one; a
 * harvest is one resource of the world the worker stands in; a craft is one recipe of the profession
 * shown.
 */
const LISTS: Readonly<Record<Mode, (listing: Listing) => Listed>> = {
  auto: ({ text, work, job_name }) => ({
    entries: [
      {
        key: JOBS,
        node: (
          <JobChips
            text={text}
            job_name={job_name}
            any
            chosen={work.mode === 'auto' ? work.job : null}
            choose={(job) => pick_quest({ work: { mode: 'auto', job } })}
          />
        ),
      },
    ],
    chosen: work.mode === 'auto' ? JOBS : null,
    hint: '',
  }),
  gather: (listing) => ({
    entries: item_entries(listing, 'gather', resource_rows(listing.worker.world ?? '')),
    chosen: chosen_item(listing.work, 'gather'),
    hint: listing.text('work_pick_resource'),
  }),
  craft: (listing) => {
    const { text, work, worker, job_name, shown, show } = listing
    const job = shown ?? (work.mode === 'craft' ? work_job(work) : null) ?? top_job(worker)
    const recipes = recipe_rows(job).map((row) => ({ ...row, job }))
    return {
      entries: [
        { key: JOBS, node: <JobChips text={text} job_name={job_name} any={false} chosen={job} choose={show} /> },
        ...item_entries(listing, 'craft', recipes),
      ],
      chosen: chosen_item(work, 'craft'),
      hint: text('work_pick_recipe'),
    }
  },
}

const WAYS: readonly Readonly<{ mode: Mode; icon: ReactNode }>[] = [
  { mode: 'auto', icon: <Bot size={18} aria-hidden="true" /> },
  { mode: 'gather', icon: <Sprout size={18} aria-hidden="true" /> },
  { mode: 'craft', icon: <Hammer size={18} aria-hidden="true" /> },
]

type WorkProps = Readonly<{ copy: AppCopy; locale: Locale; send: QuestSend }>
type WorkView = Readonly<{
  /** The way of working the player opened; null until the player opens one. */
  viewed: Mode | null
  view: (mode: Mode) => void
  /** The goal as typed. */
  entry: string | null
  enter: (entry: string | null) => void
}>
/** The list of the way opened, and the plan of what was picked from it. */
const Work = ({
  copy,
  locale,
  send,
  entry,
  enter,
  mode,
  worker,
}: WorkProps & Pick<WorkView, 'entry' | 'enter'> & Readonly<{ mode: Mode; worker: Hero }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const { job: job_name } = useVocabulary()
  const [shown, show] = useState<string | null>(null)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { work } = dapp.quest
  const { entries, chosen, hint } = LISTS[mode]({ text, work, worker, job_name, shown, show })
  const panel = usePlanInView(chosen)
  const plan = {
    copy,
    locale,
    text,
    worker,
    job_name,
    entry,
    enter,
    start: send(work_spec(dapp, account), run_title(text, work, job_name)),
    panel,
  }
  return (
    <QuestSplit
      entries={entries}
      chosen={chosen}
      plan={work.mode === 'auto' ? <AutoPlan {...plan} work={work} /> : <ItemPlan {...plan} work={work} />}
      hint={hint}
    />
  )
}

/** The three ways of working, as cards. The bot's own pick explains itself as its tooltip. */
const Ways = ({ text, mode, open }: Readonly<{ text: Text; mode: Mode | null; open: (mode: Mode) => void }>) => (
  <div className="dapp-quest-ways" role="group" aria-label={text('quest_work')}>
    {WAYS.map((way) => (
      <Button
        key={way.mode}
        className="dapp-quest-card"
        aria-pressed={mode === way.mode}
        title={way.mode === 'auto' ? text('work_auto_body') : undefined}
        data-way={way.mode}
        onClick={() => open(way.mode)}
      >
        {way.icon}
        {text(`work_${way.mode}`)}
      </Button>
    ))}
  </div>
)

/**
 * Go to work: one worker. Nothing about a work shows before the player picks what to do: its list
 * opens with the way picked, and its plan with what is picked from the list. The way opened
 * (`viewed`) and the goal as typed (`entry`) are view state; the pick is the reducer's.
 */
export const QuestWorkView = ({ copy, locale, send, viewed, view, entry, enter }: WorkProps & WorkView) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { work } = dapp.quest
  const worker = work_worker(dapp, account)
  const mode = viewed ?? (pick_said(work) ? work.mode : null)
  const open = (next: Mode): void => {
    view(next)
    enter(null)
    // The bot's pick has no item to choose: it is the pick at once.
    if (next === 'auto') pick_quest({ work: { mode: 'auto', job: null } })
  }
  // With no free hero there is nothing to plan: the Start alone says so.
  const idle = (
    <Panel className="dapp-quest-plan" aria-label={text('quest_work')} data-plan="work">
      {send(work_spec(dapp, account), text('quest_work'))}
    </Panel>
  )
  const working = (hero: Hero, way: Mode) => (
    <Work copy={copy} locale={locale} send={send} entry={entry} enter={enter} mode={way} worker={hero} />
  )
  return (
    <>
      <section className="dapp-quest-step">
        <h2 className="dapp-quest-caps">{text('work_worker')}</h2>
        <DappHeroPicker
          copy={copy}
          label={text('work_worker')}
          heroes={account.characters}
          selected={[worker].flatMap((hero) => hero?.id ?? [])}
          on_change={(hero_ids) => pick_quest({ hero_ids })}
        />
      </section>
      <section className="dapp-quest-step" data-work-mode={mode ?? undefined}>
        <h2 className="dapp-quest-caps">{text('work_what')}</h2>
        <Ways text={text} mode={mode} open={open} />
      </section>
      {mode && (worker ? working(worker, mode) : idle)}
    </>
  )
}
export const DappQuestWork = (props: WorkProps) => {
  const [viewed, view] = useState<Mode | null>(null)
  const [entry, enter] = useState<string | null>(null)
  return <QuestWorkView {...props} viewed={viewed} view={view} entry={entry} enter={enter} />
}
