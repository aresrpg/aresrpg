// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The star-gate chip — portals the "press T" content into the element the ENGINE floats over
// the origin portal (the mount-chip's own DNA from components/PromptChip.tsx).

import { createPortal } from 'react-dom'

import type { AppCopy } from '../i18n/copy.ts'
import { usePortalPrompt } from '../game/core/portal_prompt_feed.ts'

import { PromptChip, PromptKey, split_key_template } from './PromptChip.tsx'

export const PortalPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const root = usePortalPrompt()
  if (!root) return null
  const template = copy.world_hud.portal_prompt ?? 'Press {{key}} to travel to another world'
  const [before, after] = split_key_template(template)
  return createPortal(
    <PromptChip>
      {before?.trim()}
      <PromptKey label="T" />
      {after?.trim()}
    </PromptChip>,
    root
  )
}
