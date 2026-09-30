// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DoorOpen, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { item_icon } from '../content/assets.ts'
import { content_catalog, titleize } from '../content/catalog.ts'
import { useDungeonPortalPrompt } from '../game/core/dungeon_portal_feed.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { dungeon_entry_key, selected_dungeon_pending } from '../modules/dungeon.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { PromptChip, PromptText, usePromptKey } from './PromptChip.tsx'

export const DungeonPortalPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = useDungeonPortalPrompt()
  const { focused_id, speak } = prompt
  const [open_id, set_open_id] = useState<string | null>(null)
  const pending = useAppStore(selected_dungeon_pending)
  const text = copy_text(copy.world_hud)
  const portal = open_id ? prompt.portals[open_id] : null
  const dungeon = portal ? content_catalog.dungeon(portal.dungeon) : null
  const entry_key = useAppStore((state) => (dungeon ? dungeon_entry_key(state, dungeon.key) : null))

  const interact = (id: string | null) => {
    if (!id) return
    const target = prompt.portals[id]
    const destination = target ? content_catalog.dungeon(target.dungeon) : null
    if (!destination) return
    if (!dungeon_entry_key(read_app_state(), destination.key)) {
      const key = content_catalog.item(destination.key)?.item.name ?? destination.key
      prompt.speak(id, text('dungeon_guard_requires_key', { key }))
      return
    }
    prompt.speak(id, null)
    set_open_id(id)
  }
  usePromptKey({ enabled: prompt.focused_id !== null, activate: () => interact(prompt.focused_id) })
  useEffect(() => {
    return () => {
      if (focused_id) speak(focused_id, null)
    }
  }, [focused_id, speak])

  return (
    <>
      {Object.entries(prompt.roots).map(
        ([id, root]) =>
          prompt.focused_id === id &&
          createPortal(
            <PromptChip activate={() => interact(id)}>
              <PromptText
                template={`${text('dungeon_talk')} {{key}}`}
                touch_template={text('dungeon_talk_touch')}
                label="F"
              />
            </PromptChip>,
            root,
            id
          )
      )}
      {portal && dungeon ? (
        <ModalFrame
          close={() => set_open_id(null)}
          close_label={text('fight_close')}
          label={text('dungeon_portal')}
          max_width="max-w-lg"
          soft
        >
          <div className="relative rounded-[11px] bg-surface-low p-5" data-dungeon-entry-card>
            <div className="flex items-start gap-3 border-b border-white/8 pb-4">
              <div className="grid size-12 shrink-0 place-items-center border border-[#c8963c]/30 bg-[#c8963c]/7">
                <DoorOpen className="text-[#c8963c]" size={24} strokeWidth={1.35} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[8px] tracking-[0.24em] text-[#c8963c] uppercase">{text('dungeon_portal')}</p>
                <h2 className="mt-1 text-[16px] tracking-[0.1em] text-[#e8e4dc] uppercase">
                  {text('dungeon_city', { city: titleize(portal.city) })}
                </h2>
                <p className="mt-1 text-[8px] tracking-[0.14em] text-[#626975]">
                  [{portal.zx}, {portal.zz}]
                </p>
                <p className="mt-2 max-w-md text-[9px] leading-4 text-[#858b95]">{text('dungeon_entry_body')}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 border-l-2 border-[#c8963c] bg-white/[0.025] p-3">
              {item_icon(dungeon.key) ? (
                <img alt="" className="size-9 object-contain" src={item_icon(dungeon.key)!} />
              ) : (
                <KeyRound className="text-[#c8963c]" size={20} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[7px] tracking-[0.18em] text-[#6f747e] uppercase">{text('dungeon_required_key')}</p>
                <p className="mt-1 truncate text-[10px] text-[#e2c98f]">
                  {content_catalog.item(dungeon.key)?.item.name ?? dungeon.key}
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/8 pt-4">
              <button
                className="h-9 cursor-pointer px-4 text-[8px] tracking-[0.16em] text-[#777f89] uppercase hover:text-[#c7c9ce]"
                onClick={() => set_open_id(null)}
                type="button"
              >
                {text('fight_close')}
              </button>
              {entry_key && (
                <button
                  className="h-10 min-w-40 cursor-pointer border border-[#c8963c]/55 bg-[#c8963c]/10 px-5 text-[8px] font-semibold tracking-[0.17em] text-[#dcb766] uppercase shadow-[inset_0_1px_rgba(255,255,255,.05)] hover:bg-[#c8963c]/15 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={pending !== null}
                  onClick={() => {
                    dispatch_app({ type: 'dungeon/enter', portal })
                    set_open_id(null)
                  }}
                  type="button"
                >
                  {pending === 'enter' ? text('dungeon_entering') : text('dungeon_enter')}
                </button>
              )}
            </div>
          </div>
        </ModalFrame>
      ) : null}
    </>
  )
}
