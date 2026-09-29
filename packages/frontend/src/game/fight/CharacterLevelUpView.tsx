// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Button, CarvedIcon, NativeModal, ProgressionCard } from '@aresrpg/ui'
import { level_emblem } from '@aresrpg/ui/art'

import stats_icon from '../../assets/quickslots/stats.png'
import map_icon from '../../assets/quickslots/map.png'
import { content_catalog, titleize } from '../../content/catalog.ts'
import { spell_icon } from '../../content/assets.ts'
import { spell_name, type AppCopy } from '../../i18n/copy.ts'

export const CharacterLevelUpView = ({
  copy,
  name,
  classe,
  before,
  after,
  close,
  allocate,
}: Readonly<{
  copy: AppCopy
  name: string
  classe: string
  before: number
  after: number
  close: () => void
  allocate?: () => void
}>) => {
  const text = copy.fight_hud
  const spells = content_catalog.spells.filter(
    (spell) => spell.classe === classe && spell.unlock_level > before && spell.unlock_level <= after
  )
  const worlds = content_catalog.worlds.filter(({ entry_level }) => entry_level > before && entry_level <= after)
  const gained = after - before
  return (
    <NativeModal close={close} label={text.level_up_title!} className="aui-modal-scrim">
      <ProgressionCard
        title={name}
        subtitle={text.level_up_title!}
        rewards_label={copy.ui.progression_rewards}
        close={close}
        close_label={copy.wallet_close}
        icon={<img src={level_emblem} alt="" />}
        progress={
          <>
            <strong>{after}</strong>
            <p>{text.level_up_reached}</p>
          </>
        }
        rewards={
          <>
            <div className="aui-reward">
              <img src={stats_icon} alt="" />
              <div>
                <strong>+{gained * 5}</strong>
                <p>{text.level_up_stat_points}</p>
              </div>
            </div>
            <div className="aui-reward">
              <CarvedIcon name="spells" />
              <div>
                <strong>+{gained}</strong>
                <p>{text.level_up_spell_points}</p>
              </div>
            </div>
            <div className="aui-unlocks">
              {spells.map((spell) => (
                <div className="aui-reward" key={spell.name}>
                  <img src={spell_icon(classe, spell.name) ?? undefined} alt="" />
                  <div>
                    <strong>{spell_name(copy, spell.name)}</strong>
                    <p>{text.level_up_new_spell}</p>
                  </div>
                </div>
              ))}
              {worlds.map(({ world }) => (
                <div className="aui-reward" key={world}>
                  <img src={map_icon} alt="" />
                  <div>
                    <strong>{titleize(world)}</strong>
                    <p>{text.level_up_new_worlds}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        }
        action={
          <>
            <Button onClick={close}>{text.level_up_later}</Button>
            {allocate && (
              <Button tone="primary" onClick={allocate}>
                {text.level_up_allocate}
              </Button>
            )}
          </>
        }
      />
    </NativeModal>
  )
}
