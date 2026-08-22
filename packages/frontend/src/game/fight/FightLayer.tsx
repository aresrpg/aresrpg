// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity -- the fight layer explicitly composes mutually exclusive interaction states. */
// The one mounted fight surface. Pages create fights; this game layer renders every active
// checkpoint with the shared engine and, beside it, the shared HUD.

import type { EntityRender, FightPresentationCue } from '@aresrpg/engine'
import {
  fight_path_to,
  movement_points_of,
  preview_spell_cast,
  preview_weapon_strike,
  reachable_fight_cells,
  spell_area_cells,
  spell_target_cells,
  weapon_area_cells,
  weapon_target_cells,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { encyclopedia_catalog } from '../../content/catalog.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import type { SceneHandle } from '../core/scene_feed.ts'
import { dispatch_app, useAppStore } from '../../store.ts'

import { create_fight_audio_observer, play_fight_turn_start, preload_fight_sounds } from '../audio/fight_audio.ts'
import { character_render_source } from '../character_entities.ts'
import { fight_character_entity_sources, type FightCharacterAppearance } from './character_entity_sources.ts'
import { project_fight_cues } from './fight_cues.ts'
import {
  fight_visual_checkpoint,
  fight_visual_checkpoint_after_cue,
  fight_range_seat,
  fight_zone_visual_state,
  project_fight_overlays,
  type FightZoneVisualState,
} from './fight_overlays.ts'
import type { FightCuePhase } from './fight_presenter.ts'
import { FightViewport } from './FightViewport.tsx'
import { FightHud } from './FightHud.tsx'
import { presented_turn_after_cue, presented_turn_after_queue, type FightActionSelection } from './fight_projection.ts'
import { fight_mob_entity_sources, type FightMobRenderSource } from './mob_entity_sources.ts'
import { FightTargetPreviews, type FightTargetPreviewView } from './FightTargetPreviews.tsx'

const zone_visual_state = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  zone_ids: readonly string[]
): FightZoneVisualState | null => (checkpoint ? Object.freeze({ checkpoint, zone_ids }) : null)

const viewer_team_of = (
  checkpoint: Readonly<HydratedFightCheckpoint> | null,
  owner: string | null,
  character_id: string | null
): bigint | null =>
  checkpoint?.contract.fighters.find(
    (fighter) =>
      fighter.kind.type === 'player' && fighter.kind.owner === owner && fighter.kind.character === character_id
  )?.team ?? null

export const FightLayer = ({ copy, scene }: Readonly<{ copy: AppCopy; scene: SceneHandle }>) => {
  const fight = useAppStore((state) => state.fight)
  const simulator = useAppStore((state) => state.simulator)
  const session = useAppStore((state) => state.session)
  const quality = useAppStore((state) => state.settings.quality)
  const [entities, set_entities] = useState<readonly EntityRender[]>(Object.freeze([]))
  const fight_audio = useMemo(create_fight_audio_observer, [])
  const [hovered_seat, set_hovered_seat] = useState<bigint | null>(null)
  const [hovered_cell, set_hovered_cell] = useState<bigint | null>(null)
  const [selected_action, set_selected_action] = useState<FightActionSelection>(null)
  const [presentation_active, set_presentation_active] = useState(false)
  // The card stays canonical through submission; after confirmation, PLAYED cues own it instead
  // of the instantly reconciled canonical head.
  const [presented_turn_seat, set_presented_turn_seat] = useState<bigint | null>(null)
  const [crit_serial, set_crit_serial] = useState(0)
  const [restore_applied, set_restore_applied] = useState(0)
  const [chimed_turn, set_chimed_turn] = useState<string | null>(null)
  const [entity_anchors, set_entity_anchors] = useState<Readonly<Record<string, Readonly<{ x: number; y: number }>>>>(
    Object.freeze({})
  )
  const checkpoint = fight.checkpoint
  const presentation = fight.presentations[0] ?? null
  const [presented_checkpoint, set_presented_checkpoint] = useState<HydratedFightCheckpoint | null>(checkpoint)
  const canonical_zone_state = zone_visual_state(checkpoint, fight.zone_ids)
  const [presented_zone_state, set_presented_zone_state] = useState<FightZoneVisualState | null>(canonical_zone_state)
  const presentation_queued = fight.presentations.length > 0
  const render_checkpoint = fight_visual_checkpoint(presented_checkpoint, checkpoint, presentation_queued)
  const display_fighters = useMemo(
    () =>
      Object.freeze(
        (render_checkpoint?.contract.fighters ?? []).map((fighter, seat) =>
          Object.freeze({ seat, hp: fighter.hp.toString(), dead: fighter.dead })
        )
      ),
    [render_checkpoint]
  )
  const zone_render_state = presentation_queued ? (presented_zone_state ?? canonical_zone_state) : canonical_zone_state
  const owner = fight.mode === 'local' ? 'local' : (session.wallet?.address ?? null)
  const selected_character_id = fight.mode === 'remote' ? session.selected_character_id : null
  const viewer_team = viewer_team_of(checkpoint, owner, selected_character_id)
  // the viewer's own fighters — the turn-start sound rings only for them
  const owned_entity_ids = useMemo(
    () =>
      new Set(
        (checkpoint?.contract.fighters ?? []).flatMap((fighter, seat) =>
          fighter.kind.type === 'player' &&
          fighter.kind.owner === owner &&
          (selected_character_id === null || fighter.kind.character === selected_character_id)
            ? [`fight_character_${seat}`]
            : []
        )
      ),
    [checkpoint, owner, selected_character_id]
  )
  const presentation_cues = useMemo(
    () =>
      presentation
        ? project_fight_cues({
            checkpoint: presentation.checkpoint,
            events: presentation.events,
            batch: presentation.batch,
          })
        : Object.freeze([]),
    [presentation]
  )
  const presentation_pending = presentation_active || fight.presentations.length > 0
  const actions_locked = presentation_pending || fight.transaction_pending
  const appearances = useMemo<readonly FightCharacterAppearance[]>(
    () => Object.freeze([...simulator.characters, ...session.characters.map(character_render_source)]),
    [session.characters, simulator.characters]
  )
  const character_sources = useMemo(
    () =>
      render_checkpoint
        ? fight_character_entity_sources(render_checkpoint, appearances, viewer_team)
        : Object.freeze([]),
    [appearances, render_checkpoint, viewer_team]
  )
  const character_voices = useMemo(
    () => Object.freeze(Object.fromEntries(character_sources.map(({ id, male }) => [id, male]))),
    [character_sources]
  )
  const mob_sources = useMemo<readonly FightMobRenderSource[]>(
    () => (render_checkpoint ? fight_mob_entity_sources(render_checkpoint, viewer_team) : Object.freeze([])),
    [render_checkpoint, viewer_team]
  )
  const active_seat = checkpoint?.contract.queue[Number(checkpoint.contract.turn_ptr)] ?? null
  const active_fighter = active_seat === null ? null : checkpoint?.contract.fighters[Number(active_seat)]
  const owned_active_seat =
    checkpoint !== null &&
    checkpoint.contract.round !== 0n &&
    !checkpoint.contract.ended &&
    active_fighter?.kind.type === 'player' &&
    active_fighter.kind.owner === owner &&
    (selected_character_id === null || active_fighter.kind.character === selected_character_id) &&
    !active_fighter.dead &&
    !active_fighter.settled
      ? active_seat
      : null
  const own_turn_key =
    checkpoint && owned_active_seat !== null
      ? `${checkpoint.contract.id}:${owned_active_seat}:${checkpoint.contract.turn_started_ms}`
      : null
  // placement: the own seat (any owned living fighter) may re-pick among its side's start cells
  const owned_placement_seat =
    checkpoint !== null && checkpoint.contract.round === 0n && !checkpoint.contract.ended
      ? (checkpoint.contract.fighters.reduce<bigint | null>(
          (found, fighter, index) =>
            found ??
            (fighter.kind.type === 'player' &&
            fighter.kind.owner === owner &&
            (selected_character_id === null || fighter.kind.character === selected_character_id)
              ? BigInt(index)
              : null),
          null
        ) ?? null)
      : null
  const range_seat = fight_range_seat(owned_active_seat, hovered_seat)
  const movement_cells = useMemo<readonly bigint[]>(() => {
    if (!checkpoint || range_seat === null) return Object.freeze([])
    const budget = range_seat === owned_active_seat ? undefined : movement_points_of(checkpoint, range_seat)
    return reachable_fight_cells(checkpoint, range_seat, budget)
  }, [checkpoint, owned_active_seat, range_seat])
  const selected_spell = selected_action?.type === 'spell' ? selected_action.name : null
  const weapon_selected = selected_action?.type === 'weapon'
  const spell_cells = useMemo(
    () =>
      checkpoint && owned_active_seat !== null
        ? selected_spell
          ? spell_target_cells(checkpoint, owned_active_seat, selected_spell)
          : weapon_selected
            ? weapon_target_cells(checkpoint, owned_active_seat)
            : null
        : null,
    [checkpoint, owned_active_seat, selected_spell, weapon_selected]
  )
  const hovered_spell_targetable = hovered_cell !== null && Boolean(spell_cells?.targetable.includes(hovered_cell))
  const spell_preview = useMemo(
    () =>
      checkpoint && owned_active_seat !== null && hovered_cell !== null && hovered_spell_targetable
        ? selected_spell
          ? preview_spell_cast(checkpoint, owned_active_seat, selected_spell, hovered_cell)
          : weapon_selected
            ? preview_weapon_strike(checkpoint, owned_active_seat, hovered_cell)
            : null
        : null,
    [checkpoint, hovered_cell, hovered_spell_targetable, owned_active_seat, selected_spell, weapon_selected]
  )
  const spell_hover_area = useMemo(
    () =>
      checkpoint && owned_active_seat !== null && hovered_cell !== null && hovered_spell_targetable
        ? selected_spell
          ? spell_area_cells(checkpoint, owned_active_seat, selected_spell, hovered_cell)
          : weapon_selected
            ? weapon_area_cells(checkpoint, owned_active_seat, hovered_cell)
            : Object.freeze([])
        : Object.freeze([]),
    [checkpoint, hovered_cell, hovered_spell_targetable, owned_active_seat, selected_spell, weapon_selected]
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
              movements: Object.freeze([]),
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
  const blob_overlays = useMemo(
    () =>
      checkpoint
        ? project_fight_overlays({
            checkpoint,
            presentation_active: presentation_pending,
            hovered_cell,
            owned_active_seat,
            attack_selected: selected_action !== null,
            movement_cells,
            range_seat,
            spell_cells,
            spell_hover_area,
            hovered_spell_targetable,
            viewer_team,
            presented_turn_seat,
            visual_checkpoint: render_checkpoint ?? checkpoint,
            ...(zone_render_state
              ? { zone_checkpoint: zone_render_state.checkpoint, zone_ids: zone_render_state.zone_ids }
              : {}),
          })
        : Object.freeze([]),
    [
      checkpoint,
      hovered_cell,
      hovered_spell_targetable,
      movement_cells,
      owned_active_seat,
      presentation_pending,
      range_seat,
      selected_action,
      spell_cells,
      spell_hover_area,
      presented_turn_seat,
      render_checkpoint,
      viewer_team,
      zone_render_state,
    ]
  )

  useEffect(() => {
    set_presented_checkpoint((presented) =>
      fight_visual_checkpoint(presented, checkpoint, fight.presentations.length > 0)
    )
    set_presented_zone_state((presented) => {
      if (!checkpoint) return null
      if (fight.presentations.length > 0 && presented?.checkpoint.contract.id === checkpoint.contract.id)
        return presented
      return Object.freeze({ checkpoint, zone_ids: Object.freeze([...fight.zone_ids]) })
    })
  }, [checkpoint, fight.presentations.length, fight.zone_ids])

  useEffect(() => {
    set_selected_action(null)
  }, [owned_active_seat])

  useEffect(() => {
    if (!presentation || presentation_cues.length > 0) return
    dispatch_app({ type: 'fight/presented', presentation_batch: presentation.batch })
  }, [presentation, presentation_cues.length])

  useEffect(() => {
    set_presented_turn_seat((seat) => presented_turn_after_queue(seat, fight.presentations.length))
  }, [fight.presentations.length])

  useEffect(() => {
    if (!own_turn_key || presentation_pending || fight.presentations.length > 0 || chimed_turn === own_turn_key) return
    set_chimed_turn(own_turn_key)
    play_fight_turn_start()
  }, [chimed_turn, fight.presentations.length, own_turn_key, presentation_pending])

  useEffect(() => {
    set_presented_turn_seat(null)
    set_crit_serial(0)
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

  const world_anchor = useMemo(
    () =>
      checkpoint && fight.mode === 'remote'
        ? Object.freeze({
            x: chain_to_client_coordinate(Number(checkpoint.contract.x)),
            z: chain_to_client_coordinate(Number(checkpoint.contract.z)),
          })
        : null,
    [checkpoint, fight.mode]
  )
  const stable_board = useMemo(
    () => checkpoint?.contract.board ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a board is immutable under its contract identity.
    [checkpoint?.contract.id]
  )

  useEffect(() => {
    if (fight.restore_serial === 0 || fight.restore_serial === restore_applied || !checkpoint) return
    set_restore_applied(fight.restore_serial)
    set_presented_turn_seat(null)
    checkpoint.contract.fighters.forEach((fighter, seat) => {
      const entity_id = fighter.kind.type === 'mob' ? `fight_mob_${seat}` : `fight_character_${seat}`
      void scene.play_fight_cue({
        id: `${checkpoint.contract.id}:restore:${fight.restore_serial}:${seat}`,
        type: 'movement',
        entity_id,
        cells: Object.freeze([Number(fighter.cell)]),
        mode: 'teleport',
        source_id: entity_id,
        mp_spent: 0,
        gait: 'slide',
      })
    })
  }, [checkpoint, fight.restore_serial, restore_applied, scene])

  if (!checkpoint || !fight.mode) return null
  return (
    // TRANSPARENT AND CLICK-THROUGH: the board is drawn by the world engine underneath, so a
    // filled panel here would hide the very world it stands in — and cover every other page
    // while a fight is open. Only the controls inside opt back into pointer events.
    <section className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <FightViewport
        board={stable_board ?? checkpoint.contract.board}
        board_key={checkpoint.contract.id}
        // the arena stands where the challenge was thrown: the chain carries the fight's own
        // world coordinates, so the board is laid there rather than at a synthetic origin
        scene={scene}
        world_anchor={world_anchor}
        blob_overlays={blob_overlays}
        entities={entities}
        label={copy.fight_hud.board_label}
        on_presentation_active={set_presentation_active}
        on_presentation_cue={(cue: FightPresentationCue, phase: FightCuePhase) => {
          fight_audio(cue, phase, character_voices)
          if (
            cue.type === 'turn' &&
            phase === 'start' &&
            owned_entity_ids.has(cue.entity_id) &&
            own_turn_key &&
            chimed_turn !== own_turn_key
          ) {
            set_chimed_turn(own_turn_key)
            play_fight_turn_start()
          }
          set_presented_turn_seat((seat) => presented_turn_after_cue(seat, cue, phase))
          set_presented_checkpoint((presented) =>
            presented ? fight_visual_checkpoint_after_cue(presented, cue, phase) : presented
          )
          // any critical on the board pulses the vignette, whoever landed it
          if (cue.type === 'damage' && cue.critical && phase === 'start') set_crit_serial((serial) => serial + 1)
          set_presented_zone_state((presented) => fight_zone_visual_state(presented, canonical_zone_state, cue, phase))
        }}
        presentation_request={
          presentation && presentation_cues.length > 0
            ? Object.freeze({
                batch: presentation.batch,
                cues: presentation_cues,
                presented: () => {
                  dispatch_app({ type: 'fight/presented', presentation_batch: presentation.batch })
                },
              })
            : null
        }
        on_cell_click={(cell) => {
          if (!checkpoint || actions_locked) return
          if (cell === null) {
            if (selected_action !== null) set_selected_action(null)
            return
          }
          // placement phase: clicking one of the own side's free start cells re-places the fighter
          if (owned_placement_seat !== null) {
            const me = checkpoint.contract.fighters[Number(owned_placement_seat)]
            const starts =
              me?.team === 0n ? checkpoint.contract.board.start_cells_a : checkpoint.contract.board.start_cells_b
            const taken = checkpoint.contract.fighters.some((fighter) => fighter.cell === cell)
            if (!me || me.ready || taken || !starts.includes(cell)) return
            dispatch_app({
              type: 'fight/input',
              origin: 'local',
              input: { type: 'place', fighter: owned_placement_seat, cell },
            })
            return
          }
          if (owned_active_seat === null) return
          if (selected_action !== null) {
            if (!spell_cells?.targetable.includes(cell)) {
              set_selected_action(null)
              return
            }
            const action = selected_action
            set_selected_action(null)
            dispatch_app({
              type: 'fight/input',
              origin: 'local',
              input:
                action.type === 'weapon'
                  ? { type: 'weapon_strike', fighter: owned_active_seat, target_cell: cell }
                  : {
                      type: 'cast_spell',
                      fighter: owned_active_seat,
                      spell: action.name,
                      target_cell: cell,
                    },
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
      {crit_serial > 0 && <div aria-hidden className="fight-crit-vignette" key={crit_serial} />}
      <FightHud
        actions_locked={actions_locked}
        copy={copy}
        display_fighters={display_fighters}
        focus_fighter={set_hovered_seat}
        presented_turn_seat={presented_turn_seat}
        select_action={set_selected_action}
        selected_action={selected_action}
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
