// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Production UI with synthetic state; no renderer, wallet effects, or alternate layout CSS.
import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight } from '@aresrpg/fight'

import type { AuthSession } from '../../src/auth.ts'
import { WorldChat } from '../../src/components/Chat.tsx'
import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { OverworldVitals } from '../../src/game/hud/OverworldVitals.tsx'
import { FightHud } from '../../src/game/fight/FightHud.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app, initialize_app_store, observe_app, useAppStore } from '../../src/store.ts'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { TUTORIAL_IDS } from '../../src/tutorial/tutorial.ts'
import { character as fixture_character } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'
import '../../src/components/app_layout.css'
import '../../src/game/hud/world_responsive.css'

const params = new URLSearchParams(location.search)
const page = params.get('page') ?? 'world'
const weapon = content_catalog.items.find(({ item_type }) => item_type === params.get('weapon'))
const character = {
  ...fixture_character(),
  id: '0xpreview',
  name: 'Aster',
  classe: 'senshi',
  level: 20,
  equipment: weapon
    ? [
        {
          id: 'preview-weapon',
          slot: 'weapon' as const,
          amount: 1,
          item_type: weapon.item_type,
          name: weapon.name,
          level: weapon.level,
          category: weapon.category,
        },
      ]
    : [],
}
initialize_app_store({ ...load_game_settings('low'), completed_tutorials: TUTORIAL_IDS })
observe_app(['settings', 'locale'])
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: '0x' + 'aa'.repeat(32) } as AuthSession })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
dispatch_app({ type: 'character/select', character_id: character.id })
if (page === 'fight') {
  const fight = create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      fight_id: 'preview-fight',
      world: 'nauvis',
      board_seed: 17n,
      players: [
        {
          character: character.id,
          owner: 'local',
          team: 0n,
          hp: 180n,
          source: create_character_source({
            name: 'Aster',
            weapon: weapon
              ? {
                  category: weapon.category,
                  damages: (weapon.damages ?? []).map(({ element, from, to }) => ({
                    element,
                    from: BigInt(from),
                    to: BigInt(to),
                  })),
                }
              : null,
            classe: 'senshi',
            level: 20n,
            spell_levels: Object.fromEntries(
              content_catalog.spells
                .filter((spell) => spell.classe === 'senshi' && spell.unlock_level <= 20)
                .map((spell) => [spell.name, 1n])
            ),
          }),
        },
        {
          character: '0xenemy',
          owner: 'local',
          team: 1n,
          hp: 150n,
          source: create_character_source({
            name: 'Sparring partner',
            classe: 'shugo',
            level: 18n,
            spell_levels: Object.fromEntries(
              content_catalog.spells
                .filter((spell) => spell.classe === 'shugo' && spell.unlock_level <= 18)
                .map((spell) => [spell.name, 1n])
            ),
          }),
        },
      ],
      mobs: [],
    },
  })
  fight.apply({ type: 'ready', fighter: 0n })
  fight.apply({ type: 'ready', fighter: 1n })
  fight.apply({ type: 'start', observed_ms: BigInt(Date.now()) })
  dispatch_app({
    type: 'fight/reconciled',
    mode: 'local',
    checkpoint: fight.state(),
    zone_ids: [],
    events: [],
    presentation_batch: 0,
    error: null,
    awaiting_turn_witness: false,
  })
}
const Fixture = () => {
  const copy = useAppStore((state) => state.copy)!
  const settings = useAppStore((state) => state.settings)
  const locale = useAppStore((state) => state.locale)
  return (
    <LocaleScope locale={locale}>
      <main data-app-content="" className="app-ui" style={{ position: 'fixed', inset: 0 }}>
        <div data-world-frame="" className="app-world-frame" style={{ position: 'absolute', inset: 0 }}>
          <WorldChat copy={copy} />
          {page === 'fight' ? (
            <div className="preview-fight">
              <FightHud
                copy={copy}
                focus_fighter={() => {}}
                target_fighter={() => {}}
                targetable_fighter_cells={[]}
                selected_action={null}
                select_action={() => {}}
                actions_locked={false}
                mob_icon_for={() => null}
              />
            </div>
          ) : (
            <OverworldVitals />
          )}
        </div>
        {page === 'settings' && <SettingsPage copy={copy} settings={settings} />}
      </main>
    </LocaleScope>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
