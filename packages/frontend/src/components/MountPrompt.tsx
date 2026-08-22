// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The mount nametag — floats above the companion's head exactly while pressing X would work.
// The ENGINE owns the element's position (a three CSS2D label riding the frame's own camera
// pass); this component only portals the chip's content into it. Per the owner's 2026-08-21
// design call.

import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'
import { useMountPrompt } from '../game/core/mount_prompt_feed.ts'

import { PromptChip, PromptKey, split_key_template } from './PromptChip.tsx'

export const MountPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const root = useMountPrompt()
  if (!root) return null
  const template = copy.world_hud.mount_prompt ?? 'Press {{key}} to mount'
  const [before, after] = split_key_template(template)
  return createPortal(
    <PromptChip>
      {before?.trim()}
      <PromptKey label="X" />
      {after?.trim()}
    </PromptChip>,
    root
  )
}
