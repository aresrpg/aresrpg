// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DoorOpen, Footprints, MapPin, Pickaxe, Sparkles, Swords } from 'lucide-react'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import type { AgentActivity as ActivityEntry } from './activity.ts'
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
  return <AgentActivityLog copy={copy} character={character} history={session.agent_view.activity} />
}

export const AgentActivityLog = ({
  copy,
  character,
  history,
}: Readonly<{
  copy: AppCopy
  character: CharacterRow
  history: readonly ActivityEntry[]
}>) => {
  const current = character.active_fight
    ? 'fight'
    : character.dungeon_run
      ? 'dungeon'
      : character.world
        ? 'world'
        : null
  const CurrentIcon = character.active_fight ? Swords : character.dungeon_run ? DoorOpen : MapPin
  return (
    <div className="agent-activity" role="log" aria-label={copy.ui.agent_activity_label} aria-live="polite">
      {history.map((event, index) => {
        const Icon = ACTIVITY_ICONS[event.kind]
        const text = copy.ui[`agent_activity_${event.kind}`] ?? ''
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
  )
}
