// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one mounted fight surface. Pages create fights; this game layer renders every active
// checkpoint with the shared engine and, beside it, the shared HUD.

import type { EntityRender, FightPresentationCue } from '@aresrpg/engine'
import {
  fight_path_to,
  movement_points_of,
  preview_spell_cast,
  reachable_fight_cells,
  spell_area_cells,
  spell_target_cells,
} from '@aresrpg/fight'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { encyclopedia_catalog } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import { create_fight_audio_observer, preload_fight_sounds } from '../audio/fight_audio.ts'
import { fight_character_entity_sources, type FightCharacterAppearance } from './character_entity_sources.ts'
import { project_fight_cues } from './fight_cues.ts'
import type { FightCuePhase } from './fight_presenter.ts'
import { FightViewport, type FightBlobOverlay } from './FightViewport.tsx'
import { FightHud } from './FightHud.tsx'
import type { FightMobRenderSource } from './mob_entities.ts'
import { FightTargetPreviews, type FightTargetPreviewView } from './FightTargetPreviews.tsx'

const color_hex = (value: number): string => `#${value.toString(16).padStart(6, '0').slice(-6)}`

export const FightLayer = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const fight = useAppStore((state) => state.fight)
  const simulator = useAppStore((state) => state.simulator)
  const session = useAppStore((state) => state.session)
  const quality = useAppStore((state) => state.settings.quality)
  const [entities, set_entities] = useState<readonly EntityRender[]>(Object.freeze([]))
  const fight_audio = useMemo(create_fight_audio_observer, [])
  const [hovered_seat, set_hovered_seat] = useState<bigint | null>(null)
  const [hovered_cell, set_hovered_cell] = useState<bigint | null>(null)
  const [selected_spell, set_selected_spell] = useState<string | null>(null)
  const [presenting_movement, set_presenting_movement] = useState(false)
  const [entity_anchors, set_entity_anchors] = useState<Readonly<Record<string, Readonly<{ x: number; y: number }>>>>(
    Object.freeze({})
  )
  const checkpoint = fight.checkpoint
  const presentation_cues = useMemo(
    () =>
      checkpoint && fight.events.length > 0
        ? project_fight_cues({ checkpoint, events: fight.events, batch: fight.presentation_batch })
        : Object.freeze([]),
    [checkpoint, fight.events, fight.presentation_batch]
  )
  const appearances = useMemo<readonly FightCharacterAppearance[]>(
    () =>
      Object.freeze([
        ...simulator.characters,
        ...session.characters.map((character) =>
          Object.freeze({
            id: character.id,
            classe: character.classe,
            male: character.sex === 'male',
            colors: Object.freeze([
              color_hex(character.color_1),
              color_hex(character.color_2),
              color_hex(character.color_3),
            ]) as readonly [string, string, string],
            loadout: Object.freeze(
              Object.fromEntries(character.equipment.map(({ slot, item_type }) => [slot, item_type]))
            ),
          })
        ),
      ]),
    [session.characters, simulator.characters]
  )
  const character_sources = useMemo(
    () => (checkpoint ? fight_character_entity_sources(checkpoint, appearances) : Object.freeze([])),
    [appearances, checkpoint]
  )
  const character_voices = useMemo(
    () => Object.freeze(Object.fromEntries(character_sources.map(({ id, male }) => [id, male]))),
    [character_sources]
  )
  const mob_sources = useMemo<readonly FightMobRenderSource[]>(
    () =>
      checkpoint
        ? Object.freeze(
            checkpoint.contract.fighters.flatMap((fighter, seat) =>
              fighter.kind.type === 'mob'
                ? [
                    Object.freeze({
                      id: `fight_mob_${seat}`,
                      mob_type: fighter.kind.snapshot.mob_type,
                      cell: Number(fighter.cell),
                      side: fighter.team === 0n ? ('a' as const) : ('b' as const),
                    }),
                  ]
                : []
            )
          )
        : Object.freeze([]),
    [checkpoint]
  )
  const owner = fight.mode === 'local' ? 'local' : (session.wallet?.address ?? null)
  const active_seat = checkpoint?.contract.queue[Number(checkpoint.contract.turn_ptr)] ?? null
  const active_fighter = active_seat === null ? null : checkpoint?.contract.fighters[Number(active_seat)]
  const owned_active_seat =
    checkpoint !== null &&
    checkpoint.contract.round !== 0n &&
    !checkpoint.contract.ended &&
    active_fighter?.kind.type === 'player' &&
    active_fighter.kind.owner === owner &&
    !active_fighter.dead &&
    !active_fighter.settled
      ? active_seat
      : null
  const range_seat = hovered_seat ?? owned_active_seat
  const movement_cells = useMemo<readonly bigint[]>(() => {
    if (!checkpoint || range_seat === null) return Object.freeze([])
    const budget = range_seat === owned_active_seat ? undefined : movement_points_of(checkpoint, range_seat)
    return reachable_fight_cells(checkpoint, range_seat, budget)
  }, [checkpoint, owned_active_seat, range_seat])
  const movement_path = useMemo(
    () =>
      checkpoint &&
      owned_active_seat !== null &&
      hovered_cell !== null &&
      selected_spell === null &&
      range_seat === owned_active_seat
        ? fight_path_to(checkpoint, owned_active_seat, hovered_cell)
        : null,
    [checkpoint, hovered_cell, owned_active_seat, range_seat, selected_spell]
  )
  const spell_cells = useMemo(
    () =>
      checkpoint && owned_active_seat !== null && selected_spell
        ? spell_target_cells(checkpoint, owned_active_seat, selected_spell)
        : null,
    [checkpoint, owned_active_seat, selected_spell]
  )
  const hovered_spell_targetable = hovered_cell !== null && Boolean(spell_cells?.targetable.includes(hovered_cell))
  const spell_preview = useMemo(
    () =>
      checkpoint && owned_active_seat !== null && selected_spell && hovered_cell !== null && hovered_spell_targetable
        ? preview_spell_cast(checkpoint, owned_active_seat, selected_spell, hovered_cell)
        : null,
    [checkpoint, hovered_cell, hovered_spell_targetable, owned_active_seat, selected_spell]
  )
  const spell_hover_area = useMemo(
    () =>
      checkpoint && owned_active_seat !== null && selected_spell && hovered_cell !== null && hovered_spell_targetable
        ? spell_area_cells(checkpoint, owned_active_seat, selected_spell, hovered_cell)
        : Object.freeze([]),
    [checkpoint, hovered_cell, hovered_spell_targetable, owned_active_seat, selected_spell]
  )
  const preview_targets = useMemo<readonly FightTargetPreviewView[]>(() => {
    if (!checkpoint) return Object.freeze([])
    const caster_team =
      checkpoint.contract.fighters.find((fighter) => fighter.kind.type === 'player' && fighter.kind.owner === owner)
        ?.team ?? 0n
    const character_names = new Map([
      ...simulator.characters.map(({ id, name }) => [id, name] as const),
      ...session.characters.map(({ id, name }) => [id, name] as const),
    ])
    const mob_names = new Map(encyclopedia_catalog.mobs.map(({ mob_type, name }) => [mob_type, name]))
    const spell_targets = spell_preview?.targets ?? Object.freeze([])
    const hovered = hovered_seat === null ? null : checkpoint.contract.fighters[Number(hovered_seat)]
    const hovered_target =
      hovered_seat !== null &&
      hovered &&
      !hovered.dead &&
      !spell_targets.some(({ fighter }) => fighter === hovered_seat)
        ? [
            Object.freeze({
              fighter: hovered_seat,
              hp_before: hovered.hp,
              hp_after: hovered.hp,
              ap_before: hovered.ap,
              ap_after: hovered.ap,
              ap_delta: 0n,
              mp_before: hovered.mp,
              mp_after: hovered.mp,
              mp_delta: 0n,
              cell_before: hovered.cell,
              cell_after: hovered.cell,
              effects: Object.freeze([]),
            }),
          ]
        : []
    const targets = [...spell_targets, ...hovered_target]
    return Object.freeze(
      targets.flatMap((target) => {
        const fighter = checkpoint.contract.fighters[Number(target.fighter)]
        if (!fighter) return []
        return [
          Object.freeze({
            ...target,
            active_effects: Object.freeze([...fighter.effects]),
            entity_id:
              fighter.kind.type === 'player' ? `fight_character_${target.fighter}` : `fight_mob_${target.fighter}`,
            name:
              fighter.kind.type === 'player'
                ? (character_names.get(fighter.kind.character) ?? fighter.kind.character)
                : (mob_names.get(fighter.kind.snapshot.mob_type) ?? fighter.kind.snapshot.mob_type),
            allied: fighter.team === caster_team,
          }),
        ]
      })
    )
  }, [checkpoint, hovered_seat, owner, session.characters, simulator.characters, spell_preview])
  const blob_overlays = useMemo<readonly FightBlobOverlay[]>(() => {
    if (!checkpoint || presenting_movement) return Object.freeze([])
    if (hovered_seat === null && spell_cells && owned_active_seat !== null) {
      const fighter = checkpoint.contract.fighters[Number(owned_active_seat)]
      const hovered_target = hovered_spell_targetable ? hovered_cell : null
      const hovered_area = new Set(spell_hover_area)
      const overlays: readonly FightBlobOverlay[] = [
        Object.freeze({
          id: 'spell-range',
          blob: Object.freeze({
            cells: Object.freeze(spell_cells.range.filter((cell) => !hovered_area.has(cell)).map(Number)),
            shape: 'per_cell',
            color: 0x67b7ed,
            priority: 0,
            origin_cell: Number(fighter.cell),
            opacity: 0.56,
            reveal_step_ms: 15,
          }),
        }),
        Object.freeze({
          id: 'spell-targetable',
          blob: Object.freeze({
            cells: Object.freeze(spell_cells.targetable.filter((cell) => !hovered_area.has(cell)).map(Number)),
            shape: 'per_cell',
            color: 0x185ca8,
            priority: 1,
            origin_cell: Number(fighter.cell),
            opacity: 0.82,
            reveal_step_ms: 15,
            animate_updates: false,
          }),
        }),
      ]
      const hover =
        hovered_target !== null
          ? [
              Object.freeze({
                id: 'spell-hover',
                blob: Object.freeze({
                  cells: Object.freeze(spell_hover_area.map(Number)),
                  shape: 'single' as const,
                  color: 0xd73545,
                  priority: 2,
                  origin_cell: Number(hovered_target),
                  opacity: 0.92,
                  reveal_step_ms: 0,
                  animate: false,
                }),
              }),
            ]
          : []
      return Object.freeze([...overlays, ...hover])
    }
    if (range_seat === null) return Object.freeze([])
    const fighter = checkpoint.contract.fighters[Number(range_seat)]
    if (!fighter || movement_cells.length === 0) return Object.freeze([])
    const range_blob = Object.freeze({
      id: 'movement-range',
      blob: Object.freeze({
        cells: Object.freeze(movement_cells.map(Number)),
        shape: 'per_cell' as const,
        color: 0x55b979,
        priority: 0,
        origin_cell: Number(fighter.cell),
        opacity: range_seat === owned_active_seat ? 0.75 : 0.6,
        reveal_step_ms: 15,
        animate: hovered_seat === null,
      }),
    })
    const path_blob = movement_path
      ? Object.freeze({
          id: 'movement-path',
          blob: Object.freeze({
            cells: Object.freeze(movement_path.map(Number)),
            shape: 'per_cell' as const,
            color: 0x176b3a,
            priority: 1,
            origin_cell: Number(fighter.cell),
            opacity: 0.9,
            reveal_step_ms: 10,
            animate: false,
          }),
        })
      : null
    return Object.freeze(path_blob ? [range_blob, path_blob] : [range_blob])
  }, [
    checkpoint,
    hovered_cell,
    hovered_seat,
    movement_cells,
    movement_path,
    owned_active_seat,
    range_seat,
    spell_cells,
    spell_hover_area,
    hovered_spell_targetable,
    presenting_movement,
  ])

  useEffect(() => {
    set_selected_spell(null)
  }, [owned_active_seat])

  useEffect(() => {
    if (checkpoint) preload_fight_sounds(checkpoint)
    // The fight ID owns immutable participants and authored kits; commands only clone the checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preload once per fight identity.
  }, [checkpoint?.contract.id])

  useEffect(() => {
    let current = true
    void Promise.all([
      import('./character_entities.ts').then(({ load_fight_character_entities }) =>
        load_fight_character_entities(character_sources)
      ),
      import('./mob_entities.ts').then(({ fight_mob_entities }) => fight_mob_entities(mob_sources)),
    ]).then(
      ([characters, mobs]) => {
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

  if (!checkpoint || !fight.mode) return null
  return (
    <section className="pointer-events-auto absolute inset-0 z-30 overflow-hidden bg-[#08090e]">
      <FightViewport
        board={checkpoint.contract.board}
        board_key={checkpoint.contract.id}
        blob_overlays={blob_overlays}
        entities={entities}
        label={copy.fight_hud.board_label}
        on_presentation_cue={(cue: FightPresentationCue, phase: FightCuePhase) => {
          if (cue.type === 'movement') set_presenting_movement(phase === 'start')
          fight_audio(cue, phase, character_voices)
        }}
        presentation_request={
          presentation_cues.length > 0
            ? Object.freeze({
                batch: fight.presentation_batch,
                cues: presentation_cues,
                presented: () =>
                  dispatch_app({ type: 'fight/presented', presentation_batch: fight.presentation_batch }),
              })
            : null
        }
        on_cell_click={(cell) => {
          if (!checkpoint || owned_active_seat === null || presenting_movement) return
          if (selected_spell !== null) {
            if (!spell_cells?.targetable.includes(cell)) {
              set_selected_spell(null)
              return
            }
            set_selected_spell(null)
            dispatch_app({
              type: 'fight/input',
              origin: 'local',
              input: { type: 'cast_spell', fighter: owned_active_seat, spell: selected_spell, target_cell: cell },
            })
            return
          }
          const path = fight_path_to(checkpoint, owned_active_seat, cell)
          if (!path || path.length === 0) return
          dispatch_app({
            type: 'fight/input',
            origin: 'local',
            input: { type: 'move_to', fighter: owned_active_seat, path },
          })
        }}
        on_cell_hover={(cell) => {
          set_hovered_cell(cell)
          const seat = checkpoint.contract.fighters.findIndex(
            (fighter) => cell !== null && !fighter.dead && fighter.cell === cell
          )
          set_hovered_seat(seat < 0 ? null : BigInt(seat))
        }}
        on_entity_anchors={set_entity_anchors}
        quality={quality}
        show_start_cells={checkpoint.contract.round === 0n}
        tracked_entity_ids={Object.freeze(preview_targets.map(({ entity_id }) => entity_id))}
      />
      <FightTargetPreviews
        anchors={entity_anchors}
        critical={spell_preview?.critical ?? false}
        targets={preview_targets}
      />
      <FightHud
        actions_locked={presenting_movement}
        copy={copy}
        focus_fighter={set_hovered_seat}
        select_spell={set_selected_spell}
        selected_spell={selected_spell}
      />
      {fight.mode === 'local' && (
        <button
          className="absolute top-3 right-3 z-10 flex cursor-pointer items-center gap-2 border border-white/10 bg-black/55 px-3 py-2 text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase backdrop-blur hover:border-[#c8963c]/40 hover:text-[#c8963c]"
          onClick={() => dispatch_app({ type: 'fight/closed' })}
          type="button"
        >
          <RotateCcw size={12} /> {copy.simulator_page.back_to_setup}
        </button>
      )}
    </section>
  )
}
