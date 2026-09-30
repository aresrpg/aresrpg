// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { lazy, Suspense, useMemo } from 'react'
import { createPortal } from 'react-dom'

import { MobPackCard } from '../components/MobPackCard.tsx'
import { useNametags } from '../game/core/nametag_feed.ts'
import { nearest_interaction_id } from '../components/SpawnNametag.tsx'
import { Toasts } from '../components/Toasts.tsx'
import { FightLevelUpCard, FightResultCard } from '../game/fight/FightResultCard.tsx'
import { MobInspectionOverlay } from '../game/hud/MobInspectionOverlay.tsx'
import { CharacterHud } from '../game/hud/CharacterHud.tsx'
import { OverworldVitals } from '../game/hud/OverworldVitals.tsx'
import { CompassStrip } from '../game/hud/CompassStrip.tsx'
import { useWorldPose } from '../game/core/pose_feed.ts'
import { usePromptKey } from '../components/PromptChip.tsx'
import { type AppCopy } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { WorldStatus } from '../components/WorldStatus.tsx'
import { CharacterTabs } from '../components/CharacterTabs.tsx'
import { PartyFrame } from '../components/PartyFrame.tsx'
import { copy_text } from '../i18n/copy.ts'
import { JourneyTracker } from '../journey/JourneyPanel.tsx'
import { JourneyHost } from '../journey/JourneyHost.tsx'

import {
  adventure_can_fight,
  adventure_has_ending,
  adventure_objective,
  adventure_roster,
  selected_adventurer,
} from './quest.ts'
import { AdventureRebirth } from './AdventureRebirth.tsx'
import { AdventureJourneySource } from './JourneySource.tsx'
import { adventure_group, adventure_mob, adventure_item, ADVENTURE_ITEMS, ADVENTURE_PET_ITEM } from './content.ts'
import { adventure_character_row, adventure_available_inventory } from './projection.ts'
import '../characters/characters.css'

const GamePageWindow = lazy(() =>
  import('../components/GamePageWindow.tsx').then((module) => ({ default: module.GamePageWindow }))
)
const AdventureStatus = ({ copy, visible }: Readonly<{ copy: AppCopy; visible: boolean }>) => {
  const adventure = useAppStore((state) => state.adventure)
  const character = selected_adventurer(adventure)
  const roster = adventure_roster(adventure).map((actor) => adventure_character_row(actor))
  const select = (character_id: string) => dispatch_app({ type: 'adventure/select', character_id })
  return (
    <WorldStatus copy={copy} party_available={false}>
      {visible && (
        <>
          <CharacterTabs
            characters={roster}
            copy={copy}
            create_character={null}
            select_character={select}
            selected_character_id={character?.id ?? null}
          />
          <JourneyTracker copy={copy} />
          <JourneyHost copy={copy} />
        </>
      )}
    </WorldStatus>
  )
}

export const AdventurePartyFrame = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const adventure = useAppStore((state) => state.adventure)
  if (!adventure.companion || adventure.phase !== 'explore') return null
  return (
    <PartyFrame
      copy={copy}
      source={{
        party: {
          id: 'adventure',
          members: adventure_roster(adventure).map(({ id, name }) => ({ character_id: id, name })),
          invited: [],
        },
        selected: adventure.selected_character_id,
        following: adventure.following,
        follow: (enabled) => dispatch_app({ type: 'adventure/follow', enabled }),
        select: (character_id) => dispatch_app({ type: 'adventure/select', character_id }),
      }}
    />
  )
}

export const AdventureHud = ({ copy, challenge }: Readonly<{ copy: AppCopy; challenge: () => void }>) => {
  const adventure = useAppStore((state) => state.adventure)
  const { encounter, phase } = adventure
  const result = adventure_has_ending(adventure) ? null : adventure.result
  const character = selected_adventurer(adventure)
  const objective = adventure_objective(adventure)
  const row = useMemo(() => (character ? adventure_character_row(character) : null), [character])
  const mounted = useAppStore((state) => state.fight.mounted)
  const pose = useWorldPose()
  const group = useMemo(() => adventure_group(encounter), [encounter])
  const nearby = nearest_interaction_id([group], pose) !== null
  const label = useNametags().spawns[group.id]
  const encounter_visible = phase === 'explore' && adventure_can_fight(adventure)
  usePromptKey({ enabled: nearby && encounter_visible, activate: challenge })
  const acknowledge = (screen: 'result' | 'level'): void =>
    dispatch_app({ type: 'adventure/result_acknowledged', screen })
  if (phase === 'complete') return <AdventureRebirth copy={copy} />
  if (!row) return null
  return (
    <>
      {!mounted && (
        <>
          <CompassStrip
            copy={copy}
            objective={{ ...objective.position, label: copy_text(copy.adventure)(`${objective.quest}_title`) }}
          />
          <OverworldVitals character={row} />
        </>
      )}
      {encounter_visible &&
        label &&
        createPortal(
          <MobPackCard members={group.members} copy={copy} active={nearby} action_key="F" mob_for={adventure_mob} />,
          label
        )}
      <FightResultCard
        items={[...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM]}
        copy={copy}
        result={result}
        on_close={() => acknowledge('result')}
      />
      <FightLevelUpCard
        copy={copy}
        result={result}
        on_acknowledge={() => acknowledge('level')}
        on_allocate={() => acknowledge('level')}
        can_allocate={false}
      />
      <AdventureJourneySource copy={copy}>
        <AdventureStatus copy={copy} visible={!mounted && phase === 'explore'} />
      </AdventureJourneySource>
      <CharacterHud
        copy={copy}
        character={row}
        leave={() => globalThis.location.assign('/')}
        session={{
          inventory: adventure_available_inventory(adventure),
          commit: (equipment) => dispatch_app({ type: 'adventure/equipment_changed', equipment }),
          raise_stats: (spending) => dispatch_app({ type: 'adventure/stats_raised', spending }),
        }}
      />
      <MobInspectionOverlay copy={copy} mob_for={adventure_mob} item_for={adventure_item} />
      <Suspense fallback={null}>
        <GamePageWindow copy={copy} />
      </Suspense>
      <Toasts />
    </>
  )
}
