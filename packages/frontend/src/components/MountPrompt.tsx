// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The mount nametag — floats above the companion's head exactly while pressing X would work.
// The ENGINE owns the element's position (a three CSS2D label riding the frame's own camera
// pass); this component only portals the chip's content into it. Per the owner's 2026-08-21
// design call.

import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'
import { useMountPrompt } from '../game/core/mount_prompt_feed.ts'

import { PromptChip, PromptText } from './PromptChip.tsx'

export const MountPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = useMountPrompt()
  if (!prompt) return null
  return createPortal(
    <PromptChip activate={prompt.activate}>
      <PromptText
        template={prompt.riding ? `${copy.world_hud.dismount_pet} {{key}}` : copy.world_hud.mount_prompt!}
        touch_template={copy.world_hud[prompt.riding ? 'dismount_prompt_touch' : 'mount_prompt_touch']!}
        label="X"
      />
    </PromptChip>,
    prompt.root
  )
}
