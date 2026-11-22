// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The plan of a work: who works, when it stops, what one harvest or one try gives, what it needs, and
// its Start. Every figure is the game's own profession rule; a hero never buys, so what is missing is
// only shown with its way to the market.
import type { ReactNode, Ref } from 'react'
import { Field, Panel, SegmentedControl } from '@aresrpg/ui'
import { job_max_level } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import type { Locale } from '../i18n/locale.ts'
import { useItemCategoryName } from '../i18n/useItemCategoryName.ts'
import { useAppStore } from '../store.ts'
import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'

import { account_bag, job_level } from './account.ts'
import { item_name } from './copy.ts'
import { DappMarketLink } from './DappMarketLink.tsx'
import { mob_name, pick_quest, PlanRow, range_text } from './DappQuestParts.tsx'
import { cap_valid, type WorkGoal, type WorkPick } from './strategies.ts'
import { craft_facts, gather_facts, work_job, work_needs, work_tries, type WorkNeeds } from './work.ts'

import './dapp_quest.css'

type Hero = Readonly<CharacterRow>
type Text = (key: string, values?: Readonly<Record<string, string>>) => string
/** One resource or one recipe: the picks that name an item and carry a goal. */
export type ItemWork = Exclude<WorkPick, { mode: 'auto' }>
export type JobName = (job: string) => string

const UNTIL_STOPPED: WorkGoal = { kind: 'until_stopped' }
/** A level goal belongs to one profession: another item starts again from "until stopped". */
export const kept_goal = (work: WorkPick): WorkGoal =>
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
/** The worker and its level in the profession at hand. */
const WorkerRow = ({
  text,
  worker,
  job,
  job_name,
}: Readonly<{ text: Text; worker: Hero; job: string | null; job_name: JobName }>) => {
  const started = job !== null && Number(worker.jobs[job] ?? 0) > 0
  const level =
    job &&
    (started
      ? text('work_job_level', { job: job_name(job), level: String(job_level(worker, job)) })
      : text('work_job_new', { job: job_name(job) }))
  return (
    <PlanRow label={text('work_worker')} data-worker-job={job ?? undefined}>
      {[worker.name, level].filter(Boolean).join(' · ')}
    </PlanRow>
  )
}

type Working = Readonly<{ text: Text; locale: Locale; work: ItemWork; worker: Hero }>
/** One harvest by this worker, by the game's rules, with what a harvest may also bring. */
const GatherFacts = ({ text, locale, work, worker }: Working) => {
  const facts = gather_facts(worker, work.item_type)
  if (!facts) return null
  const { quantity, seconds, xp } = facts
  const time = seconds.toLocaleString(locale, { maximumFractionDigits: 1 })
  const rule = text('work_gather_hint', {
    name: worker.name,
    min: String(quantity.min),
    max: String(quantity.max),
    seconds: time,
    xp: String(xp),
  })
  return (
    <>
      <PlanRow label={text('work_per_harvest')} hint={rule} data-work-facts="gather">
        {range_text(text, quantity.min, quantity.max)}
      </PlanRow>
      <PlanRow label={text('work_harvest_time')} hint={rule}>
        {seconds.toLocaleString(locale, { style: 'unit', unit: 'second', maximumFractionDigits: 1 })}
      </PlanRow>
      <PlanRow label={text('work_xp')} hint={rule}>
        {xp.toLocaleString(locale)}
      </PlanRow>
      <PlanRow
        label={text('work_rare')}
        hint={text('work_rare_find', { item: item_name(facts.rare_item_type), mob: mob_name(facts.protector) })}
      >
        {item_name(facts.rare_item_type)}
      </PlanRow>
    </>
  )
}
/** One try by this worker, by the game's rules. */
const CraftFacts = ({ text, locale, work, worker }: Working) => {
  const facts = craft_facts(worker, work.item_type)
  if (!facts) return null
  const rule = text('work_craft_hint', { name: worker.name, percent: String(facts.percent), xp: String(facts.xp) })
  return (
    <>
      <PlanRow label={text('work_success')} hint={rule} data-work-facts="craft">
        {(facts.percent / 100).toLocaleString(locale, { style: 'percent' })}
      </PlanRow>
      <PlanRow label={text('work_xp')} hint={rule}>
        {facts.xp.toLocaleString(locale)}
      </PlanRow>
    </>
  )
}
const FACTS: Readonly<Record<ItemWork['mode'], (props: Working) => ReactNode>> = {
  gather: GatherFacts,
  craft: CraftFacts,
}
/** How many harvests or tries an amount takes on average: the row's name, and its sentence. */
const TRIES: Readonly<Record<ItemWork['mode'], Readonly<{ label: string; rule: string }>>> = {
  gather: { label: 'work_harvests_label', rule: 'work_harvests' },
  craft: { label: 'work_tries_label', rule: 'work_tries' },
}
/** What one harvest or one try gives, and how many an amount takes on average. */
const WorkFacts = (props: Working) => {
  const { text, locale, work, worker } = props
  const Facts = FACTS[work.mode]
  const tries = work_tries(worker, work)
  const { label, rule } = TRIES[work.mode]
  return (
    <>
      <Facts {...props} />
      {tries !== null && (
        <PlanRow
          label={text(label)}
          hint={text(rule, {
            tries: String(tries),
            amount: String(goal_number(work.goal)),
            item: item_name(work.item_type),
          })}
          data-work-tries=""
        >
          {text('about', { value: tries.toLocaleString(locale) })}
        </PlanRow>
      )}
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
  work,
  level,
  entry,
  enter,
}: Omit<Working, 'locale' | 'worker'> &
  Readonly<{ level: number; entry: string | null; enter: (entry: string | null) => void }>) => {
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
        <div className="dapp-quest-number">
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
        </div>
      )}
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
    return (
      <PlanRow label={text('work_tool')} hint={tool.worn ? undefined : text('work_tool_bag', values)}>
        {text(tool.worn ? 'work_tool_worn' : 'work_tool_held', values)}
      </PlanRow>
    )
  }
  // The lowest tool of the profession is the one any worker can wear.
  const [first] = content_catalog.items
    .filter((item) => item.category === category)
    .toSorted((left, right) => left.level - right.level)
  const kind = category_name(category)
  return (
    <PlanRow
      label={text('work_tool')}
      hint={text('work_tool_missing', { tool: kind })}
      data-tool-missing={tool.job}
      data-tone="alert"
    >
      <span>{text('work_tool_none', { tool: kind })}</span>
      {first && <DappMarketLink copy={copy} item_type={first.item_type} checks={false} />}
    </PlanRow>
  )
}

/** What the work takes from the worker's own kiosk. Nothing here buys: a missing material links to the market. */
const Needs = ({ copy, text, work, worker }: Omit<Working, 'locale'> & Readonly<{ copy: AppCopy }>) => {
  const account = useAppStore(({ session }) => session.agent_inventory)
  const bag = account_bag(account)
  if (!bag) return <p className="dapp-run-line">{text('bag_loading')}</p>
  const { tool, materials } = work_needs(bag, worker, work)
  if (!tool && !materials.length) return null
  return (
    <div className="dapp-quest-field" data-needs="">
      <h3 className="dapp-quest-caps">{text('work_needs')}</h3>
      <dl className="dapp-quest-ledger">
        {tool && <ToolNeed copy={copy} text={text} tool={tool} worker={worker} />}
        {materials.map(({ item_type, need, have, missing }) => {
          const icon = item_icon(item_type)
          const values = { item: item_name(item_type), need: String(need), have: String(have) }
          const rule = missing
            ? `${text('work_material_missing', { ...values, missing: String(missing) })} ${text('work_never_buys')}`
            : text('work_material_ready', values)
          return (
            <PlanRow
              key={item_type}
              label={
                <>
                  {icon && <img src={icon} alt="" />}
                  {values.item}
                </>
              }
              hint={rule}
              data-material={item_type}
              data-missing={missing || undefined}
              data-tone={missing ? 'alert' : undefined}
            >
              <span>{text('work_have', values)}</span>
              {missing > 0 && <DappMarketLink copy={copy} item_type={item_type} checks={false} />}
            </PlanRow>
          )
        })}
      </dl>
    </div>
  )
}

/** The run's title: what the player reads on the run card while the hero works. */
export const run_title = (text: Text, work: WorkPick, job_name: JobName): string => {
  if (work.mode === 'auto')
    return work.job ? text('quest_run_work_job', { job: job_name(work.job) }) : text('quest_work')
  return text(work.mode === 'gather' ? 'quest_run_gather' : 'quest_run_craft', { item: item_name(work.item_type) })
}

type PlanProps = Readonly<{
  copy: AppCopy
  locale: Locale
  text: Text
  worker: Hero
  job_name: JobName
  entry: string | null
  enter: (entry: string | null) => void
  start: ReactNode
  panel: Ref<HTMLElement>
}>
/** The plan of the bot's own pick: who works, in which profession, and its Start. */
export const AutoPlan = ({
  text,
  work,
  worker,
  job_name,
  start,
  panel,
}: PlanProps & Readonly<{ work: Extract<WorkPick, { mode: 'auto' }> }>) => (
  <Panel ref={panel} className="dapp-quest-plan" aria-label={text('work_auto')} data-plan="work">
    <h2>{text('work_auto')}</h2>
    <dl className="dapp-quest-ledger" title={text('work_auto_body')}>
      <WorkerRow text={text} worker={worker} job={work.job} job_name={job_name} />
      <PlanRow label={text('work_job')}>{work.job ? job_name(work.job) : text('work_job_any')}</PlanRow>
    </dl>
    {start}
  </Panel>
)
/**
 * The plan of one resource or one recipe: when the worker stops, what a harvest or a try gives, what
 * it needs, and its Start. A goal that is not valid as typed offers no Start.
 */
export const ItemPlan = ({
  copy,
  locale,
  text,
  work,
  worker,
  job_name,
  entry,
  enter,
  start,
  panel,
}: PlanProps & Readonly<{ work: ItemWork }>) => {
  const job = work_job(work)
  const level = job_level(worker, job ?? '')
  const icon = item_icon(work.item_type)
  return (
    <Panel ref={panel} className="dapp-quest-plan" aria-label={item_name(work.item_type)} data-plan="work">
      <h2>
        {icon && <img src={icon} alt="" />}
        {item_name(work.item_type)}
      </h2>
      <Objective text={text} work={work} level={level} entry={entry} enter={enter} />
      <dl className="dapp-quest-ledger">
        <WorkerRow text={text} worker={worker} job={job} job_name={job_name} />
        <WorkFacts text={text} locale={locale} work={work} worker={worker} />
      </dl>
      <Needs copy={copy} text={text} work={work} worker={worker} />
      {goal_ready(work, entry, level) && start}
    </Panel>
  )
}
