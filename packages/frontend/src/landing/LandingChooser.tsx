// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The chooser: one selection lights a card and fills the stage with that interface's preview and next step.
import { createContext, useContext, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'

import { ExternalLink } from '../components/links.tsx'

import { InterfacePreview } from './LandingPreviews.tsx'
import type { LandingAccountRuntime, LandingAccountState } from './landing_account.ts'
import {
  AgentLink,
  CHOOSER_ID,
  CTA_PRIMARY,
  INTERFACE_PLAY,
  INTERFACE_STATE,
  InterfaceIcon,
  SectionRule,
  type Copy,
  type Play,
} from './landing_parts.tsx'
import { INTERFACE_IDS, type InterfaceId, type LandingAssets, type LandingLinks } from './landing_types.ts'

export type Selection = Readonly<{ selected: InterfaceId; on_select: (id: InterfaceId) => void }>
type Entry = Readonly<{ links: LandingLinks; on_play: Play; agent_connect_url: string }>

const KEY_STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/** Arrow keys move the radio selection and its focus together. */
const rove = (event: Readonly<KeyboardEvent<HTMLDivElement>>, { selected, on_select }: Selection): void => {
  const step = KEY_STEP[event.key]
  if (step === undefined) return
  event.preventDefault()
  const count = INTERFACE_IDS.length
  const next = INTERFACE_IDS[(INTERFACE_IDS.indexOf(selected) + step + count) % count]!
  on_select(next)
  event.currentTarget.querySelector<HTMLElement>(`[data-if="${next}"]`)?.focus()
}

export const InterfaceState = ({ id, copy }: Readonly<{ id: InterfaceId }> & Copy) => (
  <span className="state" data-state={INTERFACE_STATE[id]}>
    <i aria-hidden="true" />
    {copy.chooser.items[id].status}
  </span>
)

/** The page's shared sign-in, for the one step that acts as the signed-in account. Absent in the build-time render. */
export const LandingAccountContext = createContext<LandingAccountRuntime | null>(null)

/** What the step is waiting for: its own request, or the sign-in before it. Null when it can be pressed. */
const waitlist_progress = (state: LandingAccountState, copy: Copy['copy']): string | null => {
  if (state.waitlist === 'joining') return copy.chooser.waitlist.joining
  return state.status === 'restoring' || state.status === 'connecting' ? copy.account.logging_in : null
}

/** Joining stores the signed-in account's address; a signed-out visitor signs in first, in the same step. */
const WaitlistStep = ({
  account,
  copy,
  className,
}: Copy & Readonly<{ account: LandingAccountRuntime; className: string }>) => {
  const state = useStore(account.store)
  const progress = waitlist_progress(state, copy)
  if (state.waitlist === 'joined')
    return (
      <span className="if-note" role="status">
        {copy.chooser.waitlist.joined}
      </span>
    )
  return (
    <>
      <button
        aria-busy={progress !== null || undefined}
        className={className}
        disabled={progress !== null}
        onClick={() => void account.join_waitlist()}
        onFocus={account.warm}
        onPointerEnter={account.warm}
        type="button"
      >
        {progress ?? copy.chooser.items.telegram.cta}
      </button>
      {state.waitlist === 'failed' && (
        <span className="if-note" data-tone="error" role="alert">
          {copy.chooser.waitlist.failed}
        </span>
      )}
    </>
  )
}

const TelegramStep = ({ copy, className }: Copy & Readonly<{ className: string }>) => {
  const account = useContext(LandingAccountContext)
  if (account) return <WaitlistStep account={account} className={className} copy={copy} />
  // The build-time render has no account: the control is inert until the page starts.
  return (
    <button className={className} disabled type="button">
      {copy.chooser.items.telegram.cta}
    </button>
  )
}

type LinkName = keyof LandingLinks
const FURTHER_READING: Readonly<
  Partial<Record<InterfaceId, Readonly<{ link: LinkName; label: 'agent_guide' | 'source' }>>>
> = { agent: { link: 'agent_guide', label: 'agent_guide' }, sdk: { link: 'source', label: 'source' } }

type Step = Readonly<{ id: InterfaceId }> & Copy & Entry

const PrimaryStep = ({
  id,
  copy,
  links,
  on_play,
  agent_connect_url,
  className,
}: Step & Readonly<{ className: string }>) => {
  const label = copy.chooser.items[id].cta
  if (id === 'world')
    return (
      <button className={CTA_PRIMARY} onClick={() => on_play()} type="button">
        {label}
      </button>
    )
  if (id === 'agent')
    return (
      <AgentLink className={className} href={agent_connect_url} on_play={on_play}>
        {label}
      </AgentLink>
    )
  // The web dapp is part of this app: it opens in the same tab and shares the sign-in.
  if (id === 'dapp')
    return (
      <AgentLink className={className} href={links.dapp} on_play={on_play}>
        {label}
      </AgentLink>
    )
  if (id === 'telegram') return <TelegramStep className={className} copy={copy} />
  return (
    <ExternalLink className={className} new_tab={copy.new_tab} href={links.playbook}>
      {label}
    </ExternalLink>
  )
}

/** The next step of one interface. `compact` is the closing reminder: one quiet link, no further reading. */
export const InterfaceActions = ({ compact = false, ...step }: Step & Readonly<{ compact?: boolean }>) => {
  const more = compact ? undefined : FURTHER_READING[step.id]
  return (
    <>
      <PrimaryStep {...step} className={compact ? 'link' : CTA_PRIMARY} />
      {more && (
        <ExternalLink className="link" new_tab={step.copy.new_tab} href={step.links[more.link]}>
          {step.copy.chooser[more.label]}
        </ExternalLink>
      )}
    </>
  )
}

const InterfaceCard = ({ id, copy, selected, on_select }: Readonly<{ id: InterfaceId }> & Copy & Selection) => {
  const item = copy.chooser.items[id]
  const checked = id === selected
  const play = INTERFACE_PLAY[id]
  return (
    <button
      aria-checked={checked}
      className="if-card rim"
      data-if={id}
      onClick={() => on_select(id)}
      role="radio"
      tabIndex={checked ? 0 : -1}
      type="button"
    >
      <span className="if-top">
        <span aria-hidden="true" className="if-logo">
          <InterfaceIcon id={id} />
        </span>
        {play && (
          <span className="if-play" data-play={play}>
            {copy.chooser.play[play]}
          </span>
        )}
      </span>
      <span className="if-name">{item.name}</span>
      <span className="if-line">{item.line}</span>
      <span className="if-foot">
        <span className="if-tech">{item.tech}</span>
        <InterfaceState copy={copy} id={id} />
      </span>
    </button>
  )
}

const InterfaceSpecs = ({ id, copy }: Readonly<{ id: InterfaceId }> & Copy) => {
  const item = copy.chooser.items[id]
  const labels = copy.chooser.specs
  const rows = [
    [labels.runs_in, item.runs_in],
    [labels.role, item.role],
    [labels.good_for, item.good_for],
    [labels.status, item.status],
  ] as const
  return (
    <dl className="specs">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export const LandingChooser = ({
  copy,
  assets,
  selected,
  on_select,
  ...entry
}: Readonly<{ assets: LandingAssets }> & Copy & Selection & Entry) => {
  const { chooser } = copy
  const item = chooser.items[selected]
  return (
    <section
      aria-labelledby="landing-chooser-title"
      className="sec wrap chooser"
      data-active={selected}
      id={CHOOSER_ID}
    >
      <SectionRule index="01" label={chooser.section} />
      <div className="sec-head" data-reveal="">
        <h2 className="h2" id="landing-chooser-title">
          {chooser.title}
        </h2>
        <p>{chooser.intro}</p>
      </div>
      <div
        aria-labelledby="landing-chooser-title"
        className="if-list"
        data-reveal=""
        onKeyDown={(event) => rove(event, { selected, on_select })}
        role="radiogroup"
      >
        {INTERFACE_IDS.map((id) => (
          <InterfaceCard copy={copy} id={id} key={id} on_select={on_select} selected={selected} />
        ))}
      </div>
      <div aria-live="polite" className="if-stage rim brackets">
        <div className="if-panel" key={selected}>
          <InterfacePreview assets={assets} copy={copy} id={selected} />
          <div className="if-copy">
            <p className="micro">{chooser.interface}</p>
            <h3 className="if-title">{item.name}</h3>
            <p className="if-desc">{item.body}</p>
            <InterfaceSpecs copy={copy} id={selected} />
            <div className="if-ctas">
              <InterfaceActions copy={copy} id={selected} {...entry} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
