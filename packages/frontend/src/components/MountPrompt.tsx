// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The mount nametag — floats above the companion's head exactly while pressing X would work.
// The ENGINE owns the element's position (a three CSS2D label riding the frame's own camera
// pass); this component only portals the chip's content into it. Soft-rounded chip with a real
// keycap glyph, per the owner's 2026-08-21 design call.

import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'
import { useMountPrompt } from '../game/core/mount_prompt_feed.ts'

export const MountPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const root = useMountPrompt()
  if (!root) return null
  const template = copy.world_hud.mount_prompt ?? 'Press {{key}} to mount'
  const [before, after] = template.split('{{key}}')
  return createPortal(
    <div className="pointer-events-none -translate-y-full">
      <div className="flex items-center gap-1.5 rounded-xl border border-white/12 bg-[#0a0a0f]/82 px-3 py-1.5 text-[10px] tracking-[0.18em] whitespace-nowrap text-[#e8e4dc] uppercase shadow-[0_4px_18px_rgba(0,0,0,0.45)] backdrop-blur-md">
        {before?.trim()}
        <kbd className="inline-grid min-w-[18px] place-items-center rounded-[5px] border border-white/25 border-b-2 border-b-white/40 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold text-[#f5d0a9] shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]">
          X
        </kbd>
        {after?.trim()}
      </div>
    </div>,
    root
  )
}
