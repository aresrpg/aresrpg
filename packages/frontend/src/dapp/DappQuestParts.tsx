// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the two modes of the Quest tab share: the pick, the list a mode chooses from with the plan of
// the choice beside it, and the rows a plan is made of.
import { Fragment, useEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode, type Ref } from 'react'

import { dispatch_app } from '../store.ts'
import { content_catalog, titleize } from '../content/catalog.ts'

import type { QuestPick } from './state.ts'
import type { ActivityPlan, StartSpec } from './strategies.ts'

import './dapp_quest.css'

type Text = (key: string, values?: Readonly<Record<string, string>>) => string

/** What a mode adds to the Start of its plan: its rows above the fee limit, and its link beside the button. */
export type SendParts = Readonly<{ rows?: (plan: ActivityPlan) => ReactNode; link?: ReactNode }>
/** How a mode asks the tab to send its heroes: the Start of this spec under this run title. */
export type QuestSend = (spec: StartSpec, title: string, parts?: SendParts) => ReactNode

export const pick_quest = (pick: Partial<QuestPick>): void => dispatch_app({ type: 'dapp/quest_pick', pick })

export const mob_name = (mob_type: string): string => content_catalog.mob(mob_type)?.mob.name ?? titleize(mob_type)
/** Two bounds as one value; equal bounds are one number. */
export const range_text = (text: Text, min: number, max: number): string =>
  min === max ? String(min) : text('plan_range', { min: String(min), max: String(max) })

/**
 * One fact of a plan: its name and its value. A fact that needs a sentence carries it as its tooltip.
 * It is a row of a `<dl className="dapp-quest-ledger">`.
 */
export const PlanRow = ({
  label,
  hint,
  children,
  ...row
}: Readonly<Omit<ComponentProps<'div'>, 'title'> & { label: ReactNode; hint?: string }>) => (
  <div {...row} title={hint}>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

type Entry = Readonly<{ key: string; node: ReactNode }>
/**
 * What a mode chooses from, and the plan of the entry chosen. Side by side the plan stands beside the
 * list and stays in view while the list scrolls; on one column it follows its entry. While nothing is
 * chosen there is no plan: the side says what to pick, and one column says nothing more than the
 * list. A choice the list does not show (a place of another world, a recipe of another profession)
 * keeps its plan.
 */
export const QuestSplit = ({
  entries,
  chosen,
  plan,
  hint,
}: Readonly<{ entries: readonly Entry[]; chosen: string | null; plan: ReactNode; hint: string }>) => {
  const at = entries.findIndex(({ key }) => key === chosen)
  const rows = { '--quest-rows': entries.length } as CSSProperties
  return (
    <div className="dapp-quest-split" style={rows}>
      {entries.map(({ key, node }, index) => (
        <Fragment key={key}>
          <div className="dapp-quest-entry">{node}</div>
          {index === at && plan}
        </Fragment>
      ))}
      {at < 0 && chosen !== null && plan}
      {chosen === null && (
        <p className="dapp-quest-hint" data-plan-hint="">
          {hint}
        </p>
      )}
    </div>
  )
}
/**
 * Brings its element into view when `value` changes to one that `shows`, never on the first render: a
 * tab that opens stays at its top. `shows` is a fixed rule, not a new function on each render.
 */
const useBroughtIntoView = <Value,>(value: Value, shows: (now: Value, last: Value) => boolean): Ref<HTMLElement> => {
  const target = useRef<HTMLElement>(null)
  const last = useRef(value)
  useEffect(() => {
    if (shows(value, last.current)) target.current?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line functional/immutable-data -- a ref is React's own cell: the value last seen
    last.current = value
  }, [value, shows])
  return target
}
const newly_chosen = (now: string | null, last: string | null): boolean => now !== null && now !== last
const grew = (now: number, last: number): boolean => now > last
/** The plan of an entry comes into view when the player chooses that entry: on one column it is under it. */
export const usePlanInView = (chosen: string | null): Ref<HTMLElement> => useBroughtIntoView(chosen, newly_chosen)
/** The heroes that are out come into view when one more goes out: a Start answers where the player looks. */
export const useRunsInView = (running: number): Ref<HTMLElement> => useBroughtIntoView(running, grew)
