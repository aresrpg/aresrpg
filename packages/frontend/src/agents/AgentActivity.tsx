// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DoorOpen, Footprints, MapPin, Pickaxe, Sparkles, Swords } from 'lucide-react'
import type { CharacterRow, HostedAgentActivity } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { current_agent_activity, type AgentActivity as ActivityEntry } from './activity.ts'
import { displayed_character } from './observation.ts'
import './activity.css'

const ACTIVITY_ICONS = {
  level: Sparkles,
  profession: Pickaxe,
  travel: Footprints,
  fight_entered: Swords,
  fight_left: DoorOpen,
}

export const AgentActivity = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const session = useAppStore((state) => state.session)
  const character = displayed_character(session)
  if (!character || session.agent_view.status !== 'ready' || session.link_status !== 'ready') return null
  return (
    <AgentActivityLog
      copy={copy}
      character={character}
      history={session.agent_view.activity}
      activity={current_agent_activity(session)}
    />
  )
}

export const AgentActivityLog = ({
  copy,
  character,
  history,
  activity = null,
}: Readonly<{
  copy: AppCopy
  character: CharacterRow
  history: readonly ActivityEntry[]
  activity?: HostedAgentActivity | null
}>) => {
  const { kind, Icon: CurrentIcon } = [
    { present: character.active_fight, kind: 'fight', Icon: Swords },
    { present: character.dungeon_run, kind: 'dungeon', Icon: DoorOpen },
    { present: character.world, kind: 'world', Icon: MapPin },
  ].find(({ present }) => present) ?? { kind: null, Icon: MapPin }
  const current = activity?.status ?? kind
  return (
    <div className="agent-activity">
      {activity?.objective && <AgentObjective objective={activity.objective} issue={activity.issue} />}
      <div role="log" aria-label={copy.ui.agent_activity_label} aria-live="polite">
        {history.map((event, index) => {
          const Icon = ACTIVITY_ICONS[event.kind]
          const text = copy.ui[`agent_activity_${event.kind}`]!
          return (
            <p className="agent-activity-done" key={`${index}:${event.kind}`}>
              <span>{event.kind === 'level' ? text.replace('{level}', String(event.level)) : text}</span>
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

const AgentObjective = ({
  objective,
  issue,
}: Readonly<{ objective: NonNullable<HostedAgentActivity['objective']>; issue?: string }>) => (
  <div className="agent-activity-objective">
    <strong>{objective.title}</strong>
    {issue && <p className="agent-activity-now">{issue}</p>}
    {objective.description && <div>{objective.description}</div>}
    <ul>
      {objective.steps?.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ul>
  </div>
)
