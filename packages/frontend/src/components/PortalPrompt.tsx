// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The star-gate chip — portals the "press T" content into the element the ENGINE floats over
// the origin portal (the mount-chip's own DNA from components/PromptChip.tsx).

import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'
import { usePortalPrompt } from '../game/core/portal_prompt_feed.ts'

import { PromptChip, PromptText } from './PromptChip.tsx'

export const PortalPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const prompt = usePortalPrompt()
  if (!prompt) return null
  return createPortal(
    <PromptChip activate={prompt.activate}>
      <PromptText
        template={copy.world_hud.portal_prompt!}
        touch_template={copy.world_hud.portal_prompt_touch!}
        label="T"
      />
    </PromptChip>,
    prompt.root
  )
}
