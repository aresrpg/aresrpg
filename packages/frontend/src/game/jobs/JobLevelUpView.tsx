// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { craft_required_level } from '@aresrpg/immutable'
import { Button, NativeModal, ProgressionCard } from '@aresrpg/ui'

import { JobEmblem } from '../../characters/JobEmblem.tsx'
import jobs_icon from '../../assets/quickslots/jobs.png'
import { content_catalog } from '../../content/catalog.ts'
import { item_icon } from '../../content/assets.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'
import { useVocabulary } from '../../i18n/useVocabulary.ts'
import type { JobLevelUp } from '../../modules/job_level_up.ts'

export const JobLevelUpView = ({
  copy,
  level_up,
  close,
}: Readonly<{ copy: AppCopy; level_up: JobLevelUp; close: () => void }>) => {
  const text = copy_text(copy.characters_page)
  const vocabulary = useVocabulary()
  const detail = content_catalog.job(level_up.job)
  const resources =
    detail?.resources.filter(
      ({ required_level }) => required_level > level_up.level_before && required_level <= level_up.level_after
    ) ?? []
  const recipes =
    detail?.recipes.filter(({ inputs }) => {
      const required = craft_required_level(Object.keys(inputs).length)
      return required > level_up.level_before && required <= level_up.level_after
    }) ?? []
  return (
    <NativeModal close={close} label={text('jobs.level_up_title')} className="aui-modal-scrim">
      <ProgressionCard
        title={vocabulary.job(level_up.job)}
        subtitle={text('jobs.level_up_title')}
        rewards_label={copy.ui.progression_rewards}
        kind="profession"
        close={close}
        close_label={copy.wallet_close}
        icon={<JobEmblem job={level_up.job} />}
        progress={
          <>
            <strong>{text('level', { level: level_up.level_after })}</strong>
            <p>{text('jobs.level_up_character', { name: level_up.character_name })}</p>
          </>
        }
        rewards={
          <>
            <div className="aui-unlocks">
              {resources.map(({ row }) => {
                const item = content_catalog.item(row.item_type)?.item
                return (
                  <div className="aui-reward" key={row.item_type}>
                    <img src={item_icon(row.item_type) ?? undefined} alt="" />
                    <div>
                      <strong>{item?.name ?? row.item_type}</strong>
                      <p>{copy.demo_page.resources}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            {recipes.length > 0 && (
              <div className="aui-reward">
                <img src={jobs_icon} alt="" />
                <div>
                  <strong>+{recipes.length}</strong>
                  <p>{text('jobs.recipes_fallback')}</p>
                </div>
              </div>
            )}
          </>
        }
        action={
          <Button tone="primary" onClick={close}>
            {text('jobs.level_up_continue')}
          </Button>
        }
      />
    </NativeModal>
  )
}
