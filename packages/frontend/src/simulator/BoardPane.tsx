// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Setup board wiring. The shared viewport reports cells; this component owns only the established pickers.

import type { EntityRender, FightBlobShape, FightBlobSpec } from '@aresrpg/engine'
import { useEffect, useMemo, useState } from 'react'

import { FightViewport } from '../game/fight/FightViewport.tsx'
import type { SceneHandle } from '../game/core/scene_feed.ts'
import {
  character_entity_sources,
  load_fight_character_entities,
  type FightCharacterRenderSource,
} from '../game/fight/character_entities.ts'
import { fight_mob_entities } from '../game/fight/mob_entities.ts'
import { mob_model_scalar_for_level } from '../game/mob_entities.ts'
import type { FightMobRenderSource } from '../game/fight/mob_entity_sources.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { simulator_board } from '../modules/simulator.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { simulator_cell_intent } from './board_intent.ts'
import { CharacterPicker } from './CharacterPicker.tsx'
import { simulator_debug_blob } from './debug_blob.ts'
import { MobModal } from './MobModal.tsx'

type CharacterPick = Readonly<{ cell: bigint; x: number; y: number }>
type BlobDebug = Readonly<{ color: number; range: number; shape: FightBlobShape }>

export const SimulatorBoardPane = ({
  copy,
  blob_debug,
  scene,
}: Readonly<{
  copy: AppCopy
  blob_debug: BlobDebug | null
  /** the stage this setup board is mounted in, owned by the page above */
  scene: SceneHandle
}>) => {
  const simulator = useAppStore((state) => state.simulator)
  const quality = useAppStore(({ settings }) => settings.quality)
  const [character_pick, set_character_pick] = useState<CharacterPick | null>(null)
  const [mob_cell, set_mob_cell] = useState<bigint | null>(null)
  const [entities, set_entities] = useState<readonly EntityRender[]>(Object.freeze([]))
  const [blob_request, set_blob_request] = useState<Readonly<{ sequence: number; blob: FightBlobSpec }> | null>(null)
  const setup_board = useMemo(() => simulator_board(simulator), [simulator])
  const mob_sources = useMemo<readonly FightMobRenderSource[]>(
    () =>
      Object.freeze(
        Object.entries(simulator.mob_placements).map(([cell, placement]) =>
          Object.freeze({
            id: `sim_mob_${cell}`,
            mob_type: placement.mob_type,
            cell: Number(cell),
            side: 'b',
            level_scalar: mob_model_scalar_for_level(placement.mob_type, placement.level),
          })
        )
      ),
    [simulator.mob_placements]
  )
  const character_sources = useMemo<readonly FightCharacterRenderSource[]>(
    () => character_entity_sources(simulator.characters, simulator.character_placements, 'a'),
    [simulator.character_placements, simulator.characters]
  )

  useEffect(() => {
    let current = true
    const mobs = fight_mob_entities(mob_sources)
    void load_fight_character_entities(character_sources).then(
      (characters) => {
        if (current) set_entities(Object.freeze([...characters, ...mobs]))
      },
      (error: unknown) => {
        console.error('Failed to resolve fight entity models.', error)
        if (current) set_entities(Object.freeze([]))
      }
    )
    return () => {
      current = false
    }
  }, [character_sources, mob_sources])

  return (
    <>
      <FightViewport
        scene={scene}
        board={setup_board}
        board_key={`simulator:${simulator.seed}`}
        blob_request={blob_request}
        entities={entities}
        label={copy.simulator_page.fight_board}
        on_cell_click={(cell, pointer) => {
          if (cell === null) return
          if (blob_debug) {
            const blob = simulator_debug_blob(setup_board, cell, blob_debug.range, blob_debug.shape, blob_debug.color)
            if (blob) set_blob_request((current) => Object.freeze({ sequence: (current?.sequence ?? 0) + 1, blob }))
            return
          }
          const intent = simulator_cell_intent(setup_board, simulator, cell)
          if (intent?.type === 'pick_character') set_character_pick({ cell, ...pointer })
          else if (intent?.type === 'unplace_character') dispatch_app({ type: 'simulator/character_unplaced', cell })
          else if (intent?.type === 'edit_mob') set_mob_cell(cell)
        }}
        quality={quality}
      />
      {character_pick && (
        <CharacterPicker
          at={character_pick}
          characters={simulator.characters}
          close={() => set_character_pick(null)}
          copy={copy}
          pick={(character_id) => {
            dispatch_app({ type: 'simulator/character_placed', cell: character_pick.cell, character_id })
            set_character_pick(null)
          }}
          placements={simulator.character_placements}
        />
      )}
      {mob_cell !== null && <MobModal cell={mob_cell} close={() => set_mob_cell(null)} copy={copy} />}
    </>
  )
}
