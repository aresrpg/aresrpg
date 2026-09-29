// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'

import source from '../../../../seed/content/adventure.json'
import { PromptChip, PromptKey, usePromptKey } from '../components/PromptChip.tsx'
import { nearest_interaction_id } from '../components/SpawnNametag.tsx'
import { ContextMenu } from '../components/ContextMenu.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import type { create_world } from '../game/core/world.ts'
import { read_pose, useWorldPose } from '../game/core/pose_feed.ts'
import { resolve_world_hover } from '../game/core/player_pick.ts'
import { dispatch_app, useAppStore } from '../store.ts'

export const CompanionInteraction = ({
  world,
  canvas,
  copy,
}: Readonly<{
  world: ReturnType<typeof create_world> | null
  canvas: HTMLCanvasElement | null
  copy: AppCopy
}>) => {
  const adventure = useAppStore((state) => state.adventure)
  const text = useMemo(() => copy_text(copy.adventure), [copy])
  const pose = useWorldPose()
  const point = source.companion.position
  const nearby = nearest_interaction_id([{ id: source.companion.id, ...point }], pose) !== null
  const available = adventure.encounter > 0 && !adventure.companion && adventure.phase === 'explore'
  const [anchor, set_anchor] = useState<HTMLElement | null>(null)
  const [menu, set_menu] = useState<Readonly<{ x: number; y: number }> | null>(null)
  const can_invite = adventure.dialogue === source.dialogue.length
  const talk = () => dispatch_app({ type: 'adventure/talk' })
  const invite = () => dispatch_app({ type: 'adventure/invite' })
  const interaction = can_invite
    ? {
        activate: invite,
        keyboard: () => false,
        label: text('invite_action'),
        menu_label: copy.world_hud.menu_group,
        key: null,
      }
    : {
        activate: talk,
        keyboard: talk,
        label: text('speak_action'),
        menu_label: text('speak_action'),
        key: <PromptKey label="F" />,
      }
  useEffect(() => {
    if (!world || !available) return
    const element = document.createElement('div')
    world.set_world_label('adventure_sceat_action', element, [point.x, point.y + 3.4, point.z])
    set_anchor(element)
    return () => {
      world.set_world_label('adventure_sceat_action', null, null)
      set_anchor(null)
    }
  }, [world, available, point])
  useEffect(() => {
    if (!world) return
    const line = source.dialogue[adventure.dialogue ?? -1]
    world.set_entity_caption(
      source.companion.id,
      available
        ? {
            name: source.companion.name,
            speech: line ? text(`dialogue_${line}`) : undefined,
          }
        : null
    )
    return () => world.set_entity_caption(source.companion.id, null)
  }, [world, available, adventure.dialogue, text])
  usePromptKey({
    enabled: available && nearby,
    activate: interaction.keyboard,
  })
  useEffect(() => {
    if (!canvas || !world || !available) return
    const pick = (event: Readonly<MouseEvent>) => {
      const own = read_pose()
      const view = world.camera_frame()
      if (!own || !view) return
      const rect = canvas.getBoundingClientRect()
      const hover = resolve_world_hover({
        view,
        width: rect.width,
        height: rect.height,
        cursor_x: event.clientX - rect.left,
        cursor_y: event.clientY - rect.top,
        own,
        candidates: [{ ...point, character_id: source.companion.id }],
      })
      if (hover.target || world.hit_entity_caption(source.companion.id, event.clientX, event.clientY)) {
        event.preventDefault()
        set_menu({ x: event.clientX, y: event.clientY })
      }
    }
    canvas.addEventListener('contextmenu', pick)
    return () => canvas.removeEventListener('contextmenu', pick)
  }, [canvas, world, available, point])
  useEffect(() => {
    if (!menu) return
    const close = () => set_menu(null)
    globalThis.addEventListener('pointerdown', close)
    return () => globalThis.removeEventListener('pointerdown', close)
  }, [menu])
  if (!available) return null
  return (
    <>
      {nearby &&
        anchor &&
        createPortal(
          <PromptChip
            activate={() => {
              if (!can_invite) return interaction.activate()
              const rect = anchor.getBoundingClientRect()
              set_menu({ x: rect.left, y: rect.bottom })
            }}
            on_context_menu={(event) => {
              event.preventDefault()
              set_menu({ x: event.clientX, y: event.clientY })
            }}
          >
            {interaction.key}
            {interaction.label}
          </PromptChip>,
          anchor
        )}
      {menu && (
        <ContextMenu {...menu}>
          <button
            type="button"
            role="menuitem"
            className="w-full p-3 text-left"
            disabled={!nearby}
            onClick={() => {
              interaction.activate()
              set_menu(null)
            }}
          >
            {interaction.menu_label}
          </button>
        </ContextMenu>
      )}
    </>
  )
}
