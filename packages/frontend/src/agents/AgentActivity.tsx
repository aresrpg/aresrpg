// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  Castle,
  DoorOpen,
  Footprints,
  LogOut,
  MapPin,
  Pickaxe,
  Sparkles,
  Swords,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import type { CharacterRow, HostedObjective } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import {
  current_agent_activity,
  hero_whereabouts,
  type AgentActivity as ActivityEntry,
  type HeroActivity,
} from './activity.ts'
import { activity_text } from './activity_text.ts'
import { displayed_character } from './observation.ts'
import './activity.css'

const ACTIVITY_ICONS: Readonly<Record<ActivityEntry['kind'], LucideIcon>> = {
  level: Sparkles,
  profession: Pickaxe,
  travel: Footprints,
  fight_entered: Swords,
  fight_left: DoorOpen,
  experience: TrendingUp,
  dungeon: Castle,
  dungeon_left: LogOut,
}
const PLACE_ICONS = { fight: Swords, dungeon: DoorOpen, world: MapPin }

export const AgentActivity = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const locale = useAppStore((state) => state.locale)
  const character = displayed_character(session)
  if (!character || session.agent_view.status !== 'ready' || session.link_status !== 'ready') return null
  return (
    <AgentActivityLog
      copy={copy}
      character={character}
      history={session.agent_view.activity}
      activity={current_agent_activity(session)}
      locale={locale}
    />
  )
}

export const AgentActivityLog = ({
  copy,
  character,
  history,
  activity = null,
  locale,
}: Readonly<{
  copy: AppCopy
  character: CharacterRow
  history: readonly ActivityEntry[]
  activity?: HeroActivity | null
  locale?: string
}>) => {
  const place = hero_whereabouts(character)
  const CurrentIcon = place ? PLACE_ICONS[place] : MapPin
  const current = activity?.status ?? place
  return (
    <div className="agent-activity">
      {activity?.objective && <AgentObjective copy={copy} objective={activity.objective} run={activity} />}
      <div role="log" aria-label={copy.ui.agent_activity_label} aria-live="polite">
        {history.map((event, index) => {
          const Icon = ACTIVITY_ICONS[event.kind]
          const { action, result } = activity_text(copy, event, locale)
          return (
            <p className="agent-activity-done" key={`${index}:${event.kind}`}>
              <span>{result ? `${action} ${result}` : action}</span>
              <Icon aria-hidden="true" />
            </p>
          )
        })}
        {current && (
          <p className="agent-activity-now">
            <span>{copy.ui[`agent_activity_${current}`]}</span>
            <CurrentIcon aria-hidden="true" />
          </p>
        )}
      </div>
    </div>
  )
}

/** The run's goal, and under its title the one sentence of a blocker. The bot's issue is an attribute for diagnostics. */
const AgentObjective = ({
  copy,
  objective,
  run: { notice, issue },
}: Readonly<{ copy: AppCopy; objective: HostedObjective; run: Pick<HeroActivity, 'notice' | 'issue'> }>) => (
  <div className="agent-activity-objective" data-issue={issue}>
    <strong>{objective.title}</strong>
    {notice && <p className="agent-activity-now">{copy.agent_page[`run_notice_${notice}`]}</p>}
    {objective.description && <div>{objective.description}</div>}
    <ul>
      {objective.steps?.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ul>
  </div>
)
