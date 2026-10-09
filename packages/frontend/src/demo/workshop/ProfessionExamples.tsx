// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo } from 'react'
import { Workspace } from '@aresrpg/ui'
import { job_xp_for_level } from '@aresrpg/immutable'
import { Hammer, Pickaxe } from 'lucide-react'

import JobsTab from '../../characters/JobsTab.tsx'
import RuneforgeTab from '../../characters/RuneforgeTab.tsx'
import { adventure_character } from '../../adventure/character.ts'
import { adventure_character_row, adventure_inventory } from '../../adventure/projection.ts'
import { content_catalog } from '../../content/catalog.ts'
import { copy_text, type AppCopy } from '../../i18n/copy.ts'

import { WorkshopSurface } from './shared.tsx'
import '../../characters/characters.css'

export const JobsExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const character = useMemo(() => {
    const tools = adventure_inventory(content_catalog.items.filter((item) => item.category === 'tool_herbalist'))
    return {
      ...adventure_character_row({ ...adventure_character(), loadout: { tool: tools[0]!.item_type } }, tools),
      jobs: { HERBALIST: String(job_xp_for_level(100)) },
    }
  }, [])
  return (
    <WorkshopSurface copy={copy} title={copy_text(copy.characters_page)('tab_jobs')} icon={<Pickaxe />}>
      {(header) => (
        <Workspace {...header} className="aui-feature-port aui-jobs-port">
          <JobsTab character={character} copy={copy} preview />
        </Workspace>
      )}
    </WorkshopSurface>
  )
}
export const RuneforgeExample = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const character = useMemo(() => adventure_character_row(adventure_character()), [])
  const inventory = useMemo(
    () =>
      adventure_inventory(content_catalog.items.filter((item) => item.category === 'hat' || item.category === 'rune')),
    []
  )
  return (
    <WorkshopSurface copy={copy} title={copy_text(copy.characters_page)('tab_runeforge')} icon={<Hammer />}>
      {(header) => (
        <Workspace {...header} className="aui-feature-port aui-forge-port">
          <RuneforgeTab character={character} copy={copy} inventory={inventory} />
        </Workspace>
      )}
    </WorkshopSurface>
  )
}
