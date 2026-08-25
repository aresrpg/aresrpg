// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/* eslint-disable functional/prefer-immutable-types -- React owns browser keyboard events at this lifecycle boundary. */

import { DoorOpen, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { item_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { useDungeonPortalPrompt } from '../game/core/dungeon_portal_feed.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import { ModalFrame } from './ModalFrame.tsx'
import { NametagCard } from './NametagCard.tsx'
import { PromptKey } from './PromptChip.tsx'

export const DungeonPortalPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = useDungeonPortalPrompt()
  const [open_id, set_open_id] = useState<string | null>(null)
  const pending = useAppStore((state) => state.dungeon.pending)
  const text = copy_text(copy.world_hud)
  const portal = open_id ? prompt.portals[open_id] : null
  const dungeon = portal ? content_catalog.world(portal.world)?.dungeon : null

  useEffect(() => {
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyE' || event.repeat || !prompt.focused_id || open_id) return
      event.preventDefault()
      set_open_id(prompt.focused_id)
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [open_id, prompt.focused_id])

  return (
    <>
      {Object.entries(prompt.roots).map(([id, root]) =>
        createPortal(
          <NametagCard
            lines={
              prompt.focused_id === id
                ? [
                    {
                      key: 'enter',
                      text: (
                        <span className="inline-flex items-center gap-1.5">
                          {text('dungeon_press_enter')} <PromptKey label="E" />
                        </span>
                      ),
                    },
                  ]
                : []
            }
            name={text('dungeon_portal')}
          />,
          root,
          id
        )
      )}
      {portal && dungeon ? (
        <ModalFrame
          close={() => set_open_id(null)}
          close_label={text('fight_close')}
          label={text('dungeon_portal')}
          max_width="max-w-xl"
        >
          <div className="w-[min(560px,calc(100vw-32px))] border border-[#328dff]/35 border-t-[#57b7ff] bg-[#090d12]/97 p-6 shadow-[0_24px_90px_rgba(0,80,180,0.22)]">
            <div className="flex items-start gap-4">
              <div className="grid size-20 shrink-0 place-items-center border border-[#328dff]/25 bg-[#328dff]/8">
                <DoorOpen className="text-[#57b7ff]" size={35} strokeWidth={1.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[8px] tracking-[0.24em] text-[#57b7ff] uppercase">{text('dungeon_portal')}</p>
                <h2 className="mt-2 text-lg tracking-[0.08em] text-[#e8e4dc] uppercase">{portal.world}</h2>
                <p className="mt-2 text-[10px] leading-5 text-[#8d96a3]">{text('dungeon_entry_body')}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-3 border border-white/8 bg-black/25 p-3">
              {item_icon(dungeon.key) ? (
                <img alt="" className="size-10 object-contain" src={item_icon(dungeon.key)!} />
              ) : (
                <KeyRound className="text-[#c8963c]" size={22} />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[8px] tracking-[0.18em] text-[#777f89] uppercase">{text('dungeon_required_key')}</p>
                <p className="mt-1 truncate text-[11px] text-[#d9c49a]">
                  {content_catalog.item(dungeon.key)?.item.name ?? dungeon.key}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="h-11 cursor-pointer border border-white/10 text-[9px] tracking-[0.18em] text-[#8b919b] uppercase"
                onClick={() => set_open_id(null)}
                type="button"
              >
                {text('fight_close')}
              </button>
              <button
                className="h-11 cursor-pointer border border-[#328dff]/50 bg-[#328dff]/10 text-[9px] tracking-[0.18em] text-[#75c4ff] uppercase disabled:cursor-not-allowed disabled:opacity-45"
                disabled={pending !== null}
                onClick={() => {
                  dispatch_app({ type: 'dungeon/enter', portal })
                  set_open_id(null)
                }}
                type="button"
              >
                {pending === 'enter' ? text('dungeon_entering') : text('dungeon_enter')}
              </button>
            </div>
          </div>
        </ModalFrame>
      ) : null}
    </>
  )
}
