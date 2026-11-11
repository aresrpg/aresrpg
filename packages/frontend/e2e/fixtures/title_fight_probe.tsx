// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight } from '@aresrpg/fight'

import { items_by_type } from '../../src/content/items.ts'
import { useFightResources, type FightResourceLoader } from '../../src/game/fight/fight_resources.ts'
import { load_fight_character_entities } from '../../src/game/fight/character_entities.ts'
import type { SceneHandle } from '../../src/game/core/scene_feed.ts'

export const create_title_fight_probe = () => {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  let loads = 0
  let generation = 0
  let committed = 0
  const checkpoint = create_fight({
    mode: 'local',
    setup: {
      players: [
        {
          character: 'hero',
          owner: 'owner',
          team: 0n,
          hp: 55n,
          source: create_character_source({ classe: 'senshi', level: 1n }),
        },
      ],
      mobs: [],
    },
  }).state()
  const scene = {} as SceneHandle
  const loader: FightResourceLoader = {
    characters: async (sources) => {
      loads++
      return load_fight_character_entities(sources)
    },
    prepare: async () => {},
  }
  const Probe = ({ title, revision }: Readonly<{ title: string; revision: number }>) => {
    const result = useFightResources(
      checkpoint,
      scene,
      true,
      [
        {
          id: 'fight_hero',
          classe: 'senshi',
          male: true,
          colors: ['#fff', '#fff', '#fff'],
          loadout: { title },
          cell: 0,
          side: 'a',
        },
      ],
      loader
    )
    useEffect(() => {
      committed = revision
    }, [revision])
    return <div data-status={result.status} data-body={result.characters[0]?.appearance.body_url ?? ''} />
  }
  const title = (value: string) => {
    const revision = ++generation
    root.render(<Probe title={value} revision={revision} />)
    return revision
  }
  title('')
  return {
    title,
    aura_only: () => {
      Reflect.deleteProperty(items_by_type.title_veteran!, 'title_model')
      return title('title_veteran')
    },
    snapshot: () => ({
      loads,
      committed,
      status: element.firstElementChild?.getAttribute('data-status'),
      body: element.firstElementChild?.getAttribute('data-body'),
    }),
  }
}
