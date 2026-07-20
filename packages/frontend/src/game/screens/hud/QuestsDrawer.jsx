// Quests drawer body — the tutorial questbook. A master/detail panel: a LEFT ordered-chain rail
// (done / active / locked rows with a per-quest progress chip) + a RIGHT detail panel (quest header,
// status, the objective copy, and a count/required progress bar).
//
// SSOT: the quest DEFINITIONS (name, objective copy, required count, order) live in
// @aresrpg/sdk/quests (the ordered tutorial chain). The live PROGRESS is server-authoritative, pushed as
// `questsUpdate` into the `quests` store slice (core/modules/quests.js). This component renders the
// static chain merged with that progress and computes nothing.
//
// A quest ABSENT from the progress map is one the server cannot track yet (its trigger has no live
// gameplay source) — shown greyed as "coming soon", never blocking. `active_quest_id` is the
// highlighted current objective.
//
// FLAG: the @aresrpg/sdk/quests `description` strings reference "AresRPG" / the legacy reference corpus and
// use em-dashes (the source-game copy), which is off house voice (em-dashes in UI copy). They ship as
// DATA from the sdk, not literals in this file, so the constraint gate does not catch them. Do not
// rewrite 32 strings here — surface to the content owner for a house-voice pass.

import { useMemo, useState } from 'react'

import { use_game_state } from '../../store.js'
import { QUEST_CHAIN as CHAIN, quest_status, trigger_label } from './quests-data.js'
import './hud-panels.css'
import './quests.css'

/** Status glyph for a left-rail row. */
function StatusGlyph({ state }) {
  if (state === 'done')
    return (
      <svg className="quests__glyph quests__glyph--done" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 13l4 4L19 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  if (state === 'active') return <span className="quests__glyph quests__glyph--active" aria-hidden="true" />
  return (
    <svg className="quests__glyph quests__glyph--locked" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v9H5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * LEFT rail — the ordered chain, each row selectable.
 * @param {{
 *   selected_id: string,
 *   quests: import('../../core/game.js').State['quests'],
 *   on_select: (id: string) => void,
 * }} props
 */
function QuestList({ selected_id, quests, on_select }) {
  return (
    <div className="quests__list">
      {CHAIN.map((quest, index) => {
        const { count, completed, active, blocked } = quest_status(quest, quests)
        const glyph = completed ? 'done' : active ? 'active' : 'locked'
        const chip = completed ? 'Done' : blocked ? 'Soon' : `${count}/${quest.required_count}`
        return (
          <button
            key={quest.id}
            type="button"
            className={[
              'quests__row',
              quest.id === selected_id ? 'is-selected' : '',
              completed ? 'is-done' : '',
              active ? 'is-active' : '',
              blocked ? 'is-blocked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => on_select(quest.id)}
          >
            <StatusGlyph state={glyph} />
            <span className="quests__row-body">
              <span className="quests__row-num">{index + 1}</span>
              <span className="quests__row-name">{quest.name}</span>
            </span>
            <span className="quests__row-chip">{chip}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * RIGHT detail — the selected quest's header, objective copy, and progress bar.
 * @param {{
 *   quest: typeof CHAIN[number],
 *   index: number,
 *   quests: import('../../core/game.js').State['quests'],
 * }} props
 */
function QuestDetail({ quest, index, quests }) {
  const { count, completed, active, blocked } = quest_status(quest, quests)
  const pct = Math.round((count / Math.max(1, quest.required_count)) * 100)
  const badge = completed
    ? { label: 'Completed', kind: 'done' }
    : blocked
      ? { label: 'Coming soon', kind: 'soon' }
      : active
        ? { label: 'Current objective', kind: 'active' }
        : { label: 'In progress', kind: 'active' }

  return (
    <div className="quests__detail">
      <div className="quests__detail-top">
        <span className="quests__detail-num">
          Quest {index + 1} / {CHAIN.length}
        </span>
        <span className={`quests__badge quests__badge--${badge.kind}`}>{badge.label}</span>
      </div>
      <h3 className="quests__detail-name">{quest.name}</h3>

      {quest.description && <p className="quests__desc">{quest.description}</p>}

      <div className="quests__objective">
        <span className="quests__objective-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </span>
        <span className="quests__objective-body">
          <span className="quests__objective-label">Objective</span>
          <span className="quests__objective-text">
            {trigger_label(quest.trigger_type)}
            {quest.required_count > 1 ? ` ×${quest.required_count}` : ''}
          </span>
        </span>
        {!blocked && (
          <span className="quests__objective-count hud-num">
            {count}/{quest.required_count}
          </span>
        )}
      </div>

      {!blocked && (
        <div className="quests__progress">
          <div
            className="quests__bar"
            role="progressbar"
            aria-valuenow={count}
            aria-valuemin={0}
            aria-valuemax={quest.required_count}
          >
            <span className={`quests__bar-fill${completed ? ' is-done' : ''}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="quests__progress-pct hud-num">{pct}%</span>
        </div>
      )}

      {blocked && <p className="quests__soon-note">This objective unlocks once its game system goes live.</p>}
    </div>
  )
}

export function QuestsDrawer() {
  const quests = use_game_state((s) => s.quests)

  // Default selection: the active quest, else the first not-yet-done, else the first.
  const default_id = useMemo(() => {
    if (quests?.active_quest_id) return quests.active_quest_id
    const next = CHAIN.find((q) => !quests?.progress?.[q.id]?.completed)
    return next?.id ?? CHAIN[0]?.id ?? ''
  }, [quests])

  const [picked, set_picked] = useState('')
  const selected_id = picked || default_id
  const selected_index = CHAIN.findIndex((q) => q.id === selected_id)
  const selected = CHAIN[selected_index] ?? CHAIN[0]

  const done_count = CHAIN.filter((q) => quests?.progress?.[q.id]?.completed).length

  if (!selected) return <p className="hud-panel-empty">No quests available.</p>

  return (
    <div className="quests">
      <div className="quests__summary">
        <div className="quests__summary-stat">
          <span className="quests__summary-num">
            {done_count}
            <span className="quests__summary-of">/{CHAIN.length}</span>
          </span>
          <span className="quests__summary-label">Quests done</span>
        </div>
      </div>

      <div className="quests__body">
        <QuestList selected_id={selected_id} quests={quests} on_select={set_picked} />
        <QuestDetail quest={selected} index={selected_index} quests={quests} />
      </div>
    </div>
  )
}
