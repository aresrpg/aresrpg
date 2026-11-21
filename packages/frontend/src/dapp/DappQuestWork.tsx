// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Go to work: one hero, what it works on, when it stops and what it needs. Every figure is the game's
// own profession rule; a hero never buys, so what is missing is only shown with its way to the market.
import { useState, type ReactNode } from 'react'
import { Button, Field, Panel, SegmentedControl, Select } from '@aresrpg/ui'
import { job_max_level, job_slugs } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import { useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'

import { account_bag, job_level } from './account.ts'
import { dapp_text, item_name } from './copy.ts'
import { DappHeroCard } from './DappHeroCard.tsx'
import { DappHeroPicker } from './DappHeroPicker.tsx'
import { DappMarketLink } from './DappMarketLink.tsx'
import { mob_name, pick_quest, type QuestSend } from './DappQuestFight.tsx'
import { work_spec, work_worker } from './state.ts'
import { cap_valid, type WorkGoal, type WorkPick } from './strategies.ts'
import {
  craft_facts,
  gather_facts,
  recipe_rows,
  resource_rows,
  work_job,
  work_needs,
  work_tries,
  type WorkNeeds,
} from './work.ts'

import './dapp_quest.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
type Mode = WorkPick['mode']
/** One resource or one recipe: the picks that name an item and carry a goal. */
type ItemWork = Exclude<WorkPick, { mode: 'auto' }>
type JobName = (job: string) => string

const UNTIL_STOPPED: WorkGoal = { kind: 'until_stopped' }
/** A level goal belongs to one profession: another item starts again from "until stopped". */
const kept_goal = (work: WorkPick): WorkGoal =>
  work.mode !== 'auto' && work.goal.kind === 'amount' ? work.goal : UNTIL_STOPPED
/** The goal a kind starts from: one unit more, or the worker's next profession level. */
const fresh_goal = (kind: WorkGoal['kind'], level: number): WorkGoal => {
  if (kind === 'until_stopped') return UNTIL_STOPPED
  return kind === 'amount' ? { kind, amount: 1 } : { kind, level: Math.min(level + 1, job_max_level) }
}
/** The number a goal carries; null for a goal with none. */
const goal_number = (goal: WorkGoal): number | null => {
  if (goal.kind === 'until_stopped') return null
  return goal.kind === 'amount' ? goal.amount : goal.level
}
/** An amount is any whole number above zero; a level is above the worker's own and within the game's. */
const goal_entry = (goal: WorkGoal, entry: string, level: number): number | null => {
  const value = cap_valid(entry.trim()) ? Number(entry.trim()) : null
  if (value === null || goal.kind === 'amount') return value
  return value > level && value <= job_max_level ? value : null
}
const with_number = (goal: WorkGoal, value: number): WorkGoal =>
  goal.kind === 'amount' ? { kind: 'amount', amount: value } : { kind: 'job_level', level: value }
/** Whether the goal as typed can be sent. An entry that is not a valid number never becomes "no goal". */
export const goal_ready = (work: WorkPick, entry: string | null, level: number): boolean => {
  if (work.mode === 'auto') return true
  const number = goal_number(work.goal)
  return number === null || goal_entry(work.goal, entry ?? String(number), level) !== null
}
/** The profession a hero is highest in; the first one for a hero new to all of them. */
const top_job = (hero: Hero): string =>
  job_slugs.toSorted((left, right) => job_level(hero, right) - job_level(hero, left))[0]!

/** The worker, its level in the profession at hand, and the way to choose another hero. */
const WorkerRow = ({
  copy,
  text,
  worker,
  job,
  job_name,
}: Readonly<{ copy: AppCopy; text: Text; worker: Hero | null; job: string | null; job_name: JobName }>) => {
  const heroes = useAppStore(({ session }) => session.agent_inventory.characters)
  const [changing, set_changing] = useState(false)
  if (!worker) return <p className="dapp-note">{text('blocker_no_free_hero')}</p>
  const started = job !== null && Number(worker.jobs[job] ?? 0) > 0
  return (
    <>
      <DappHeroCard
        copy={copy}
        hero={worker}
        compact
        actions={
          <Button aria-expanded={changing} onClick={() => set_changing(!changing)}>
            {text('work_change')}
          </Button>
        }
      />
      {job && (
        <p className="dapp-note" data-worker-job={job}>
          {started
            ? text('work_job_level', { job: job_name(job), level: String(job_level(worker, job)) })
            : text('work_job_new', { job: job_name(job) })}
        </p>
      )}
      {changing && (
        <DappHeroPicker
          copy={copy}
          label={text('work_worker')}
          heroes={heroes}
          selected={[worker.id]}
          on_change={(hero_ids) => {
            pick_quest({ hero_ids })
            set_changing(false)
          }}
        />
      )}
    </>
  )
}

type Choice = Readonly<{ item_type: string; job: string; required_level: number }>
/** Resources or recipes to choose one from. One whose level the worker has not reached cannot be chosen. */
const Choices = ({
  text,
  rows,
  worker,
  chosen,
  job_name,
  choose,
}: Readonly<{
  text: Text
  rows: readonly Choice[]
  worker: Hero
  chosen: string | null
  job_name: JobName
  choose: (item_type: string) => void
}>) => (
  <div className="dapp-quest-choices">
    {rows.map(({ item_type, job, required_level }) => {
      const locked = job_level(worker, job) < required_level
      const icon = item_icon(item_type)
      return (
        <Button
          key={item_type}
          className="dapp-quest-choice"
          aria-pressed={chosen === item_type}
          disabled={locked}
          data-work-item={item_type}
          onClick={() => choose(item_type)}
        >
          {icon && <img src={icon} alt="" />}
          <span className="dapp-quest-choice-text">
            <b>{item_name(item_type)}</b>
            <small>
              {text(locked ? 'work_locked' : 'work_job_level', { job: job_name(job), level: String(required_level) })}
            </small>
          </span>
        </Button>
      )
    })}
  </div>
)

type WhatProps = Readonly<{ text: Text; work: WorkPick; worker: Hero; job_name: JobName }>
const chosen_item = (work: WorkPick, mode: Mode): string | null =>
  work.mode !== 'auto' && work.mode === mode ? work.item_type : null
/** The bot picks what brings the most profession progress, inside one profession when one is named. */
const AutoWork = ({ text, work, job_name }: WhatProps) => (
  <>
    <p className="dapp-note">{text('work_auto_body')}</p>
    <Select
      label={text('work_job')}
      value={(work.mode === 'auto' && work.job) || ''}
      options={[
        { value: '', label: text('work_job_any') },
        ...job_slugs.map((job) => ({ value: job, label: job_name(job) })),
      ]}
      onChange={(event) => pick_quest({ work: { mode: 'auto', job: event.target.value || null } })}
    />
  </>
)
/** One resource of the world the worker stands in. */
const GatherWork = ({ text, work, worker, job_name }: WhatProps) => (
  <Choices
    text={text}
    rows={resource_rows(worker.world ?? '')}
    worker={worker}
    chosen={chosen_item(work, 'gather')}
    job_name={job_name}
    choose={(item_type) => pick_quest({ work: { mode: 'gather', item_type, goal: kept_goal(work) } })}
  />
)
/** One recipe of one profession. The profession shown is view state; the recipe is the pick. */
const CraftWork = ({ text, work, worker, job_name }: WhatProps) => {
  const [shown, show] = useState<string | null>(null)
  const job = shown ?? (work.mode === 'craft' ? work_job(work) : null) ?? top_job(worker)
  return (
    <>
      <Select
        label={text('work_job')}
        value={job}
        options={job_slugs.map((slug) => ({ value: slug, label: job_name(slug) }))}
        onChange={(event) => show(event.target.value)}
      />
      <Choices
        text={text}
        rows={recipe_rows(job).map((row) => ({ ...row, job }))}
        worker={worker}
        chosen={chosen_item(work, 'craft')}
        job_name={job_name}
        choose={(item_type) => pick_quest({ work: { mode: 'craft', item_type, goal: kept_goal(work) } })}
      />
    </>
  )
}
const WHAT: Readonly<Record<Mode, (props: WhatProps) => ReactNode>> = {
  auto: AutoWork,
  gather: GatherWork,
  craft: CraftWork,
}

type Working = Readonly<{ text: Text; locale: Locale; work: ItemWork; worker: Hero }>
/** One harvest by this worker, by the game's rules, with what a harvest may also bring. */
const GatherFacts = ({ text, locale, work, worker }: Working) => {
  const facts = gather_facts(worker, work.item_type)
  if (!facts) return null
  return (
    <p className="dapp-run-line" data-work-facts="gather">
      {text('work_gather_hint', {
        name: worker.name,
        min: String(facts.quantity.min),
        max: String(facts.quantity.max),
        seconds: facts.seconds.toLocaleString(locale, { maximumFractionDigits: 1 }),
        xp: String(facts.xp),
      })}{' '}
      {text('work_rare_find', { item: item_name(facts.rare_item_type), mob: mob_name(facts.protector) })}
    </p>
  )
}
/** One try by this worker, by the game's rules. */
const CraftFacts = ({ text, work, worker }: Working) => {
  const facts = craft_facts(worker, work.item_type)
  if (!facts) return null
  return (
    <p className="dapp-run-line" data-work-facts="craft">
      {text('work_craft_hint', { name: worker.name, percent: String(facts.percent), xp: String(facts.xp) })}
    </p>
  )
}
const FACTS: Readonly<Record<ItemWork['mode'], (props: Working) => ReactNode>> = {
  gather: GatherFacts,
  craft: CraftFacts,
}
const TRIES: Readonly<Record<ItemWork['mode'], string>> = { gather: 'work_harvests', craft: 'work_tries' }
/** What one harvest or one try gives, and how many an amount takes on average. */
const WorkFacts = (props: Working) => {
  const { text, work, worker } = props
  const Facts = FACTS[work.mode]
  const tries = work_tries(worker, work)
  return (
    <>
      <Facts {...props} />
      {tries !== null && (
        <p className="dapp-run-line" data-work-tries="">
          {text(TRIES[work.mode], {
            tries: String(tries),
            amount: String(goal_number(work.goal)),
            item: item_name(work.item_type),
          })}
        </p>
      )}
      {work.goal.kind === 'until_stopped' && <p className="dapp-run-line">{text('quest_until_stop')}</p>}
    </>
  )
}

const GOAL_KINDS: readonly WorkGoal['kind'][] = ['until_stopped', 'amount', 'job_level']
const goal_label = (mode: ItemWork['mode'], kind: WorkGoal['kind']): string => {
  if (kind === 'until_stopped') return 'work_goal_until'
  if (kind === 'job_level') return 'work_goal_level'
  return mode === 'gather' ? 'work_goal_gather' : 'work_goal_craft'
}
/**
 * When the worker stops by itself: never, after an amount, or at a profession level. The number as
 * typed is view state: only a valid one reaches the pick, and an invalid one says so.
 */
const Objective = ({
  text,
  locale,
  work,
  worker,
  level,
  entry,
  enter,
}: Working & Readonly<{ level: number; entry: string | null; enter: (entry: string | null) => void }>) => {
  const { goal } = work
  const number = goal_number(goal)
  const change = (value: string): void => {
    enter(value)
    const next = goal_entry(goal, value, level)
    if (next !== null) pick_quest({ work: { ...work, goal: with_number(goal, next) } })
  }
  const invalid = goal.kind === 'amount' ? 'work_amount_invalid' : 'work_level_invalid'
  return (
    <div className="dapp-quest-field" data-objective={goal.kind}>
      <h3 className="dapp-quest-caps">{text('work_objective')}</h3>
      <SegmentedControl<WorkGoal['kind']>
        label={text('work_objective')}
        options={GOAL_KINDS.map((kind) => ({ value: kind, label: text(goal_label(work.mode, kind)) }))}
        value={goal.kind}
        on_change={(kind) => {
          enter(null)
          pick_quest({ work: { ...work, goal: fresh_goal(kind, level) } })
        }}
      />
      {number !== null && (
        <Field
          label={text(goal.kind === 'amount' ? 'work_how_many' : 'work_target_level')}
          error={
            goal_ready(work, entry, level)
              ? undefined
              : text(invalid, { min: String(level + 1), max: String(job_max_level) })
          }
        >
          <input
            className="aui-input"
            inputMode="numeric"
            value={entry ?? String(number)}
            onChange={(event) => change(event.target.value)}
          />
        </Field>
      )}
      <WorkFacts text={text} locale={locale} work={work} worker={worker} />
    </div>
  )
}

/** The tool a harvest needs: worn, held in the worker's kiosk, or missing with its way to the market. */
const ToolNeed = ({
  copy,
  text,
  tool,
  worker,
}: Readonly<{ copy: AppCopy; text: Text; tool: NonNullable<WorkNeeds['tool']>; worker: Hero }>) => {
  const category_name = useItemCategoryName()
  const category = `tool_${tool.job.toLowerCase()}`
  if (tool.item_type) {
    const values = { item: item_name(tool.item_type), name: worker.name }
    return <p className="dapp-run-line">{text(tool.worn ? 'work_tool_worn' : 'work_tool_bag', values)}</p>
  }
  // The lowest tool of the profession is the one any worker can wear.
  const [first] = content_catalog.items
    .filter((item) => item.category === category)
    .toSorted((left, right) => left.level - right.level)
  return (
    <div className="dapp-notice-row" data-tool-missing={tool.job}>
      <p className="dapp-run-line" data-tone="alert">
        {text('work_tool_missing', { tool: category_name(category) })}
      </p>
      {first && <DappMarketLink copy={copy} item_type={first.item_type} />}
    </div>
  )
}

/** What the work takes from the worker's own kiosk. Nothing here buys: a missing material links to the market. */
const Needs = ({ copy, text, work, worker }: Omit<Working, 'locale'> & Readonly<{ copy: AppCopy }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const bag = account_bag(account)
  if (!bag) return <p className="dapp-run-line">{text('bag_loading')}</p>
  const { tool, materials } = work_needs(bag, worker, work)
  return (
    <div className="dapp-quest-field" data-needs="">
      <h3 className="dapp-quest-caps">{text('work_needs')}</h3>
      {tool && <ToolNeed copy={copy} text={text} tool={tool} worker={worker} />}
      {materials.map(({ item_type, need, have, missing }) => (
        <div key={item_type} className="dapp-notice-row" data-material={item_type} data-missing={missing || undefined}>
          <p className="dapp-run-line">
            {text(missing ? 'work_material_missing' : 'work_material_ready', {
              item: item_name(item_type),
              need: String(need),
              have: String(have),
              missing: String(missing),
            })}
          </p>
          {missing > 0 && <DappMarketLink copy={copy} item_type={item_type} />}
        </div>
      ))}
      {materials.some(({ missing }) => missing > 0) && <p className="dapp-note">{text('work_never_buys')}</p>}
    </div>
  )
}

/** The run's title: what the player reads on the run card while the hero works. */
const run_title = (text: Text, work: WorkPick, job_name: JobName): string => {
  if (work.mode === 'auto')
    return work.job ? text('quest_run_work_job', { job: job_name(work.job) }) : text('quest_work')
  return text(work.mode === 'gather' ? 'quest_run_gather' : 'quest_run_craft', { item: item_name(work.item_type) })
}

type PlanProps = Readonly<{
  copy: AppCopy
  locale: Locale
  text: Text
  work: WorkPick
  worker: Hero | null
  mode: Mode
  entry: string | null
  enter: (entry: string | null) => void
  start: ReactNode
}>
/**
 * What the pick says, then its Start. A list open with nothing chosen from it yet offers no Start:
 * the pick still says something else. A goal that is not valid as typed offers none either.
 */
const WorkPlan = ({ copy, locale, text, work, worker, mode, entry, enter, start }: PlanProps) => {
  if (mode !== work.mode)
    return (
      <p className="dapp-run-line" data-picking={mode}>
        {text(mode === 'gather' ? 'work_pick_resource' : 'work_pick_recipe')}
      </p>
    )
  if (work.mode === 'auto')
    return (
      <>
        <p className="dapp-run-line">{text('quest_until_stop')}</p>
        {start}
      </>
    )
  // With no free hero there is nothing to plan: the Start below says so.
  if (!worker) return start
  const level = job_level(worker, work_job(work) ?? '')
  return (
    <>
      <Objective text={text} locale={locale} work={work} worker={worker} level={level} entry={entry} enter={enter} />
      <Needs copy={copy} text={text} work={work} worker={worker} />
      {goal_ready(work, entry, level) && start}
    </>
  )
}

/**
 * Go to work: one worker. What the list shows (`viewed`) and the goal as typed (`entry`) are view
 * state; the pick is the reducer's. Start is offered only for what the pick really says.
 */
export const DappQuestWork = ({ copy, locale, send }: Readonly<{ copy: AppCopy; locale: Locale; send: QuestSend }>) => {
  const dapp = useAppStore((state) => state.dapp)
  const account = useAppStore(({ session }) => session.agent_inventory)
  const { job: job_name } = useVocabulary()
  const [viewed, view] = useState<Mode | null>(null)
  const [entry, enter] = useState<string | null>(null)
  const text: Text = (key, values) => dapp_text(copy, key, values)
  const { work } = dapp.quest
  const worker = work_worker(dapp, account)
  const mode = viewed ?? work.mode
  const What = WHAT[mode]
  return (
    <>
      <section className="dapp-quest-step">
        <h2 className="dapp-quest-caps">{text('work_worker')}</h2>
        <WorkerRow copy={copy} text={text} worker={worker} job={work_job(work)} job_name={job_name} />
      </section>
      <section className="dapp-quest-step" data-work-mode={mode}>
        <SegmentedControl<Mode>
          label={text('quest_work')}
          options={[
            { value: 'auto', label: text('work_auto') },
            { value: 'gather', label: text('work_gather') },
            { value: 'craft', label: text('work_craft') },
          ]}
          value={mode}
          on_change={(next) => {
            // The bot's pick has no list to choose from: it is the pick at once.
            view(next === 'auto' ? null : next)
            enter(null)
            if (next === 'auto') pick_quest({ work: { mode: 'auto', job: null } })
          }}
        />
        {worker && <What text={text} work={work} worker={worker} job_name={job_name} />}
      </section>
      <Panel className="dapp-quest-plan" aria-label={text('quest_work')} data-plan="work">
        <WorkPlan
          copy={copy}
          locale={locale}
          text={text}
          work={work}
          worker={worker}
          mode={mode}
          entry={entry}
          enter={enter}
          start={send(work_spec(dapp, account), run_title(text, work, job_name))}
        />
      </Panel>
    </>
  )
}
