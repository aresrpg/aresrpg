// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PACK CARD — what a mob group says when you walk up to it. A group is a UNIT: the chain
// engages it whole, so it gets ONE card listing its members rather than a tag per body. The
// engine owns the element's position (a CSS2D crown over a mob pack or resource pack, riding the
// frame's own camera pass); this component only portals the content in.
//
// A MEMBER'S LEVEL IS NOT ON THE WIRE. The chain draws a `level_scalar` (0..100) per member and
// resolves it against the mob template's authored band at fight time — `fight.move::mf` does
// `level_min + (level_max - level_min) * scalar / 100`, and `@aresrpg/fight`'s create.ts already
// mirrors that arithmetic for the board. The card reads the SAME derivation, so the level shown
// here is the level that will stand on the board, not an estimate of it.

/* eslint-disable functional/prefer-immutable-types -- React lifecycle boundary. */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import { content_catalog } from '../content/catalog.ts'
import { mob_level_from_scalar } from '../content/mob_levels.ts'
import { useNametags } from '../game/core/nametag_feed.ts'
import { dispatch_app, useAppStore, type AppState } from '../store.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { live_spawns, parse_mob_group_id, parse_resource_pack_id, type WorldState } from '../modules/world.ts'
import { read_pose } from '../game/core/pose_feed.ts'
import { gather_gate } from '../game/gather_gate.ts'
import { parse_resource_node_id, resource_seats } from '../game/resource_nodes.ts'
import { selected_character } from '../modules/session.ts'
import { read_dungeon_portal_prompt } from '../game/core/dungeon_portal_feed.ts'

import { NametagCard, type NametagLine } from './NametagCard.tsx'
import { PromptKey, split_key_template } from './PromptChip.tsx'

const SPAWN_INTERACTION_RANGE_BLOCKS = 15

/** The chain's own scalar → level arithmetic (fight.move::mf, mirrored in @aresrpg/fight). */
export const member_level = mob_level_from_scalar

/** The closest tagged pack to the player — E's one target. Ties break on the id so the choice
 *  is stable frame to frame rather than flickering between two equidistant packs. */
const nearest_tagged_group = (ids: readonly string[], world: WorldState): string | null => {
  const own = read_pose()
  if (!own) return null
  return (
    ids
      .flatMap((id) => {
        const found = parse_mob_group_id(id)
        const group = found ? live_spawns(world, found.key).mobs.find(({ index }) => index === found.index) : null
        if (!group) return []
        const x = chain_to_client_coordinate(group.x)
        const z = chain_to_client_coordinate(group.z)
        const distance = Math.hypot(x - own.x, z - own.z)
        return distance <= SPAWN_INTERACTION_RANGE_BLOCKS ? [{ id, distance }] : []
      })
      .toSorted((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .at(0)?.id ?? null
  )
}

const resource_at = (id: string, state: AppState) => {
  const node = parse_resource_node_id(id)
  const found = node ? parse_resource_pack_id(node.pack_id) : null
  const pack = found ? live_spawns(state.world, found.key).resources.find(({ index }) => index === found.index) : null
  const character = selected_character(state.session)
  const resource =
    pack && character?.world
      ? (content_catalog.world(character.world)?.resources.find(({ item_type }) => item_type === pack.item_type) ??
        null)
      : null
  const seat = node && pack ? (resource_seats(node.pack_id, pack.nodes)[node.ordinal] ?? null) : null
  return node && found && pack && resource && seat ? { node, found, pack, resource, seat, character } : null
}

const nearest_tagged_resource = (ids: readonly string[], state: AppState): string | null => {
  const own = read_pose()
  if (!own) return null
  return (
    ids
      .flatMap((id) => {
        const row = resource_at(id, state)
        if (!row) return []
        const x = chain_to_client_coordinate(row.pack.x) + row.seat.dx
        const z = chain_to_client_coordinate(row.pack.z) + row.seat.dz
        const distance = Math.hypot(x - own.x, z - own.z)
        return distance <= SPAWN_INTERACTION_RANGE_BLOCKS ? [{ id, distance }] : []
      })
      .toSorted((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .at(0)?.id ?? null
  )
}

const tagged_distance = (id: string, state: AppState): number => {
  const own = read_pose()
  if (!own) return Number.POSITIVE_INFINITY
  const resource = resource_at(id, state)
  if (resource) {
    const x = chain_to_client_coordinate(resource.pack.x) + resource.seat.dx
    const z = chain_to_client_coordinate(resource.pack.z) + resource.seat.dz
    return Math.hypot(x - own.x, z - own.z)
  }
  const found = parse_mob_group_id(id)
  const group = found ? live_spawns(state.world, found.key).mobs.find(({ index }) => index === found.index) : null
  return group
    ? Math.hypot(chain_to_client_coordinate(group.x) - own.x, chain_to_client_coordinate(group.z) - own.z)
    : Number.POSITIVE_INFINITY
}

/** One member row: its species and the exact level it will bring to the board. */
const member_line = (mob_type: string, scalar: number, index: number, unknown: string): NametagLine => {
  const detail = content_catalog.mob(mob_type)?.mob
  const name = detail?.name ?? unknown
  return {
    key: `${mob_type}:${index}`,
    // the pack has no header, so every member reads as a title of its own
    title: true,
    text: detail ? `${name} · LV ${member_level(detail.level_min, detail.level_max, scalar)}` : name,
  }
}

export const SpawnNametag = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const { spawns } = useNametags()
  const state = useAppStore((value) => value)
  const { world } = state
  const text = copy_text(copy.world_hud)
  // Names advertise packs from afar, while E remains a close interaction. The target is the
  // nearest tagged spawn still inside that smaller action radius.
  const ids = Object.keys(spawns)
  const mob_target = nearest_tagged_group(ids, world)
  const resource_target = nearest_tagged_resource(ids, state)
  const selected = selected_character(state.session)
  const target =
    selected?.ambush || state.world.gathering?.character_id === selected?.id
      ? null
      : ([mob_target, resource_target]
          .filter((id): id is string => id !== null)
          .sort((a, b) => tagged_distance(a, state) - tagged_distance(b, state) || a.localeCompare(b))[0] ?? null)

  useEffect(() => {
    if (!target) return
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyE' || event.repeat) return
      if (read_dungeon_portal_prompt().focused_id) return
      const focus = event.target as HTMLElement | null
      if (focus?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(focus?.tagName ?? '')) return
      event.preventDefault()
      const resource = resource_at(target, state)
      if (resource?.character && gather_gate(resource.character, resource.resource).ok)
        dispatch_app({ type: 'world/gather', node: target })
      else if (parse_mob_group_id(target))
        dispatch_app({ type: 'world/engage', group: target, started_at_ms: Date.now() })
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [state, target])

  return (
    <>
      {Object.entries(spawns).map(([spawn_id, element]) => {
        const found = parse_mob_group_id(spawn_id)
        if (!found) {
          const row = resource_at(spawn_id, state)
          if (!row?.character) return null
          const item_name = content_catalog.item(row.pack.item_type)?.item.name ?? row.pack.item_type
          const gate = gather_gate(row.character, row.resource)
          const interactive = target === spawn_id
          const requirement = gate.ok
            ? text('resource_press_collect', { name: item_name })
            : gate.reason === 'level'
              ? text('resource_need_level', { job: gate.job, level: gate.level })
              : text('resource_need_tool', { job: gate.job })
          const [before, after] = split_key_template(requirement)
          return createPortal(
            <NametagCard
              name={item_name}
              tone={gate.ok ? 'gold' : 'muted'}
              lines={
                interactive
                  ? [
                      {
                        key: 'press',
                        muted: !gate.ok,
                        text: gate.ok ? (
                          <span className="inline-flex items-center gap-1.5">
                            {before?.trim()}
                            <PromptKey label="E" />
                            {after?.trim()}
                          </span>
                        ) : (
                          requirement
                        ),
                      },
                    ]
                  : []
              }
            />,
            element,
            spawn_id
          )
        }
        const group = live_spawns(world, found.key).mobs.find(({ index }) => index === found.index)
        // the pack was engaged (or the zone re-rolled) between the frame that floated this
        // element and this render — the card says nothing rather than the last thing it knew
        if (!group) return null
        const [before, after] = split_key_template(text('spawn_press_attack'))
        return createPortal(
          <NametagCard
            lines={[
              ...group.members.map(({ mob_type, level_scalar }, index) =>
                member_line(mob_type, level_scalar, index, text('spawn_unknown_mob'))
              ),
              ...(target === spawn_id
                ? [
                    {
                      key: 'press',
                      text: (
                        <span className="inline-flex items-center gap-1.5">
                          {before?.trim()}
                          <PromptKey label="E" />
                          {after?.trim()}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />,
          element,
          spawn_id
        )
      })}
    </>
  )
}
