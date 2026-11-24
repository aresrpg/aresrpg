// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createPortal } from 'react-dom'

import { useCrewPrompt } from '../game/core/crew_prompt_feed.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { staking_section_href } from '../site/routes.ts'

import { PromptChip, PromptText, usePromptKey } from './PromptChip.tsx'

/** The crew's gift is collected on the site's airdrop section, in a new tab so play continues. */
const open_airdrop = (): void => {
  globalThis.open(staking_section_href('airdrop'), '_blank', 'noopener,noreferrer')
}

export const CrewNpcPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const root = useCrewPrompt()
  const t = copy_text(copy.world_hud)
  usePromptKey({ enabled: root !== null, activate: open_airdrop })
  return root
    ? createPortal(
        <PromptChip activate={open_airdrop}>
          <PromptText template={`${t('crew_talk')} {{key}}`} touch_template={t('crew_talk_touch')} label="F" />
          <span className="aui-sr">{copy.site.new_tab}</span>
        </PromptChip>,
        root
      )
    : null
}
