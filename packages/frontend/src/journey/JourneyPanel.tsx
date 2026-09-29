// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useContext } from 'react'
import { ArrowRight, BookOpen, Check, ChevronDown, Compass, Sparkles } from 'lucide-react'

import automation_art from '../../../../seed/icons/world/gathering_automation_hd.png'
import automation_icon from '../../../../seed/icons/world/gathering_automation.png'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { type AppCopy } from '../i18n/copy.ts'
import { dispatch_app } from '../store.ts'

import { next_quest, type JourneyQuest } from './model.ts'
import { JourneySourceContext, useJourneySource } from './source.tsx'
import './journey.css'

const ItemArt = ({ item, className = '' }: Readonly<{ item: string; className?: string }>) => {
  const source = useContext(JourneySourceContext)
  const icon = source ? source.icon(item) : item_detail_icon(item)
  return <img alt="" className={className} draggable={false} src={icon ?? undefined} />
}

const open_path = (pathname: string): void => {
  dispatch_app({ type: 'journey/journal', open: false })
  dispatch_app({ type: 'path/open', pathname })
}

const QuestActions = ({ quest, copy }: Readonly<{ quest: JourneyQuest; copy: AppCopy }>) => {
  const source = useJourneySource(copy)
  const { text } = source
  if (source.activate || quest.kind === 'start')
    return (
      <button
        className="journey-button"
        onClick={() => (source.activate ? source.activate(quest) : dispatch_app({ type: 'journey/start' }))}
        type="button"
      >
        {source.action_label ?? text(source.activate ? 'continue' : 'start')} <ArrowRight size={15} />
      </button>
    )
  if (quest.id === 'suize') return null
  if (quest.kind === 'harvest')
    return (
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path(`/encyclopedia/items/${quest.item}`)}
        type="button"
      >
        {text('resource_details')} <ArrowRight size={14} />
      </button>
    )
  return (
    <div className="journey-actions">
      <button className="journey-button" onClick={() => open_path(`/encyclopedia/items/${quest.item}`)} type="button">
        {text(quest.kind === 'dungeon' ? 'key_details' : 'recipe')} <ArrowRight size={14} />
      </button>
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path('/characters/jobs')}
        type="button"
      >
        {text('jobs')}
      </button>
      <button
        className="journey-button journey-button--secondary"
        onClick={() => open_path('/marketplace')}
        type="button"
      >
        {copy.marketplace}
      </button>
    </div>
  )
}

const JourneyProgress = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  const count = quests.filter(({ kind, id }) => kind !== 'start' && completed.includes(id)).length
  const total = quests.filter(({ kind }) => kind !== 'start').length
  return (
    <div className="journey-progress">
      <div
        aria-label={text('progress')}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={count}
        className="journey-meter"
        role="progressbar"
      >
        <span style={{ width: `${(100 * count) / total}%` }} />
      </div>
      <div className="journey-progress-caption">
        <span>{text('progress')}</span>
        <span>{text('count', { count, total })}</span>
      </div>
    </div>
  )
}

const Milestones = ({ copy, quest }: Readonly<{ copy: AppCopy; quest: JourneyQuest | null }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  return (
    <div className="journey-milestones">
      {[...new Set(quests.map(({ chapter }) => chapter))]
        .filter((chapter) => chapter !== 'welcome')
        .map((chapter) => {
          const chapter_quests = quests.filter((row) => row.chapter === chapter)
          const done = chapter_quests.every(({ id }) => completed.includes(id))
          return (
            <div
              className={`journey-milestone ${done ? 'is-complete' : ''} ${quest?.chapter === chapter ? 'is-active' : ''}`}
              key={chapter}
            >
              <div className="journey-medal">
                <ItemArt item={chapter_quests[0]!.item} />
                {done && <Check aria-label={text('complete')} className="journey-medal-check" size={17} />}
              </div>
              <span>{text(`chapter_${chapter}`)}</span>
            </div>
          )
        })}
    </div>
  )
}

const useJourneyView = (copy: AppCopy) => {
  const { state: journey, quests } = useJourneySource(copy)
  const [celebrated] = journey.celebrations
  const quest = quests.find(({ id }) => id === celebrated) ?? next_quest(journey.completed, quests)
  const display = quest ?? { id: 'finished', chapter: 'finished', item: 'wheat_suize', kind: 'start' }
  const celebrating = Boolean(celebrated) && !journey.saving
  return { journey, celebrated, quest, display, celebrating }
}

const JourneyControls = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { journey, celebrated, quest } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  if (journey.saving)
    return (
      <button className="journey-button" disabled type="button">
        {text('saving')}
      </button>
    )
  if (celebrated)
    return (
      <button className="journey-button" onClick={source.acknowledge} type="button">
        {text('continue')} <ArrowRight size={14} />
      </button>
    )
  if (compact)
    return (
      <button className="journey-button" onClick={() => source.journal(true)} type="button">
        <BookOpen size={14} />
        {text(quest?.kind === 'start' ? 'start' : 'journal')}
      </button>
    )
  return quest ? (
    <QuestActions copy={copy} quest={quest} />
  ) : (
    <button
      className="journey-button"
      onClick={() => {
        dispatch_app({ type: 'automation/collapse', collapsed: false })
        source.collapse(true)
        open_path('/')
      }}
      type="button"
    >
      <img alt="" className="size-5" draggable={false} src={automation_icon} /> {text('automation_reward_action')}
    </button>
  )
}

const QuestCard = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { celebrated, display } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  const { id, item: item_type, chapter, kind } = display
  const item = source.name(item_type)
  const objective = text(`${id}_objective`, { item })
  return (
    <div className="journey-quest" data-quest-kind={kind}>
      <div className="journey-art">
        {id === 'finished' ? (
          <img alt="" className="journey-automation-art" draggable={false} src={automation_art} />
        ) : (
          <ItemArt item={item_type} />
        )}
      </div>
      <div className="journey-copy">
        <span className="journey-eyebrow">{text(`chapter_${chapter}`)}</span>
        <h3>{text(`${id}_title`)}</h3>
        <p>{text(`${id}_body`, { item })}</p>
        {objective && (
          <div className="journey-objective">
            <span className="journey-checkbox">{celebrated && <Check size={15} />}</span>
            <span>{objective}</span>
          </div>
        )}
        <div className="journey-actions">
          <JourneyControls compact={compact} copy={copy} />
        </div>
      </div>
    </div>
  )
}

const JourneyChecklist = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const {
    state: { completed },
    quests,
    text,
  } = useJourneySource(copy)
  return (
    <ol className="journey-checklist">
      {quests
        .filter(({ kind }) => kind !== 'start')
        .map((row) => (
          <li key={row.id}>
            <span className="journey-checkbox">
              {completed.includes(row.id) && <Check aria-label={text('complete')} size={13} />}
            </span>
            <span>{text(`${row.id}_title`)}</span>
          </li>
        ))}
    </ol>
  )
}

const JourneyNext = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { journey, celebrated } = useJourneyView(copy)
  const { quests, text } = useJourneySource(copy)
  const following = next_quest(journey.completed, quests)
  if (!celebrated || !following) return null
  return (
    <div className="journey-next">
      <ItemArt item={following.item} />
      <span>
        {text('next')} <strong>{text(`${following.id}_title`)}</strong>
      </span>
    </div>
  )
}

export const JourneyPanel = ({ copy, compact }: Readonly<{ copy: AppCopy; compact: boolean }>) => {
  const { journey, celebrated, quest, celebrating } = useJourneyView(copy)
  const source = useJourneySource(copy)
  const { text } = source
  return (
    <section
      aria-label={text('title')}
      className={`journey-panel ${compact ? 'journey-panel--compact' : ''} ${celebrating ? 'is-celebrating' : ''}`}
    >
      <header className="journey-header">
        <div>
          <span className="journey-eyebrow">{text('eyebrow')}</span>
          <h2>{text('title')}</h2>
        </div>
        {compact ? (
          <button
            aria-label={text('collapse')}
            className="journey-icon-button"
            onClick={() => source.collapse(true)}
            type="button"
          >
            <ChevronDown size={17} />
          </button>
        ) : (
          <Compass aria-hidden="true" className="text-gold" size={26} />
        )}
      </header>
      {!compact && <Milestones copy={copy} quest={quest} />}
      <JourneyProgress copy={copy} />
      {celebrating && (
        <div className="journey-complete" key={celebrated} role="status">
          <Sparkles size={17} />
          <strong>{text('complete')}</strong>
          <Check size={17} />
        </div>
      )}
      <QuestCard compact={compact} copy={copy} />
      <JourneyNext copy={copy} />
      {journey.storage_failed && (
        <p className="journey-storage-warning" role="status">
          {text('storage_failed')}
        </p>
      )}
      {!compact && <JourneyChecklist copy={copy} />}
    </section>
  )
}

export const JourneyTracker = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const source = useJourneySource(copy)
  const { state: journey, available, text } = source
  if (!journey.ready || !journey.identity || !available) return null
  return (
    <aside className="journey-tracker">
      {journey.collapsed ? (
        <button className="journey-launcher" onClick={() => source.collapse(false)} type="button">
          <BookOpen size={17} />
          <span>{text('title')}</span>
          {journey.celebrations.length > 0 && <Sparkles size={16} />}
        </button>
      ) : (
        <JourneyPanel compact copy={copy} />
      )}
    </aside>
  )
}
