// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mob_icon } from '../content/assets.ts'
import { content_catalog } from '../content/catalog.ts'
import { mob_level_from_scalar } from '../content/mob_levels.ts'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import type { WorldMobGroup } from '../game/core/spawn_residency.ts'
import { dispatch_app } from '../store.ts'

import { PromptKey } from './PromptChip.tsx'

const catalog_mob = (type: string) => content_catalog.mob(type)?.mob

export const MobPackCard = ({
  members,
  copy,
  active,
  mob_for = catalog_mob,
  action_key = 'F',
}: Readonly<{
  members: WorldMobGroup['members']
  copy: AppCopy
  active: boolean
  mob_for?: typeof catalog_mob
  action_key?: string
}>) => (
  <div className="aui-mob-pack" data-mob-pack="">
    {members.map(({ mob_type, level_scalar }, index) => {
      const mob = mob_for(mob_type)
      return (
        <button
          key={`${mob_type}:${index}`}
          type="button"
          disabled={!mob}
          onClick={() => dispatch_app({ type: 'dialog/open', dialog: `mob:${mob_type}` })}
        >
          <img src={mob_icon(mob_type) ?? undefined} alt="" />
          <span>{mob?.name ?? copy.world_hud.spawn_unknown_mob}</span>
          <strong>
            {mob &&
              copy_text(copy.encyclopedia_page)('level_short', {
                level: mob_level_from_scalar(mob.level_min, mob.level_max, level_scalar),
              })}
          </strong>
        </button>
      )
    })}
    {active && (
      <footer>
        <PromptKey label={action_key} />
        <span>{copy.ui.attack}</span>
      </footer>
    )}
  </div>
)
