// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createPortal } from 'react-dom'

import { crew_path } from '../airdrop/crew_campaign.ts'
import { useCrewPrompt } from '../game/core/crew_prompt_feed.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { dispatch_app } from '../store.ts'

import { PromptChip, PromptText, usePromptKey } from './PromptChip.tsx'

export const CrewNpcPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const root = useCrewPrompt()
  const t = copy_text(copy.world_hud)
  const activate = () => dispatch_app({ type: 'path/open', pathname: crew_path })
  usePromptKey({ enabled: root !== null, activate })
  return root
    ? createPortal(
        <PromptChip activate={activate}>
          <PromptText template={`${t('crew_talk')} {{key}}`} touch_template={t('crew_talk_touch')} label="F" />
        </PromptChip>,
        root
      )
    : null
}
