// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { Button, CombatHud } from '@aresrpg/ui'
import { compile_runtime_world_recipe, parse_world_recipe } from '@aresrpg/engine'

import { WorldMap } from '../../src/game/hud/WorldMap.tsx'
import { WorldQuickslots } from '../../src/game/hud/WorldQuickslots.tsx'
import { VitalsDisplay } from '../../src/game/hud/VitalsDisplay.tsx'
import { FightSpell } from '../../src/game/fight/FightSpell.tsx'
import { WorldChat } from '../../src/components/Chat.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { to_spell_source } from '../../src/content/fight_sources.ts'
import { world_terrain } from '../../src/content/worlds.ts'
import { create_map_resource_icons } from '../../src/game/hud/map_resource_icons.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'
import '../../src/game/fight/fight_hud.css'

declare global {
  interface Window {
    dispatch_hud_input: typeof dispatch_app
  }
}
window.dispatch_hud_input = dispatch_app

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const spells = content_catalog.spells.filter(({ classe }) => classe === 'senshi')
const root = createRoot(document.getElementById('root')!)
const DamageVitals = () => {
  const [hp, set_hp] = useState(1040n)
  return (
    <>
      <VitalsDisplay hp={hp} max_hp={1040n} ap={6n} mp={3n} />
      {new URLSearchParams(location.search).has('damage') && (
        <button
          style={{ position: 'fixed', left: 0, top: -200, pointerEvents: 'auto' }}
          onClick={() => set_hp(hp - 104n)}
        >
          Take damage
        </button>
      )}
    </>
  )
}
if (new URLSearchParams(location.search).has('map')) {
  publish_pose({ character_id: 'fixture', x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0.5 })
  const compiled = compile_runtime_world_recipe(world_terrain('nauvis'))
  root.render(
    <WorldMap compiled={compiled} copy={copy} on_close={() => undefined} resource_icons={create_map_resource_icons()} />
  )
} else {
  root.render(
    <main style={{ position: 'fixed', inset: 0, background: '#292d30' }}>
      <div className="fight-hud" data-chat-viewport="">
        <WorldChat copy={copy} />
        <div className="fight-hud__bottom">
          <CombatHud
            label="Combat"
            vitals={<DamageVitals />}
            spells={spells.map((spell) => {
              const source = to_spell_source(spell)
              const details = source.levels[5]!
              return (
                <FightSpell
                  key={spell.name}
                  spell={{
                    name: spell.name,
                    level: 6n,
                    source,
                    details,
                    cooldown: 0n,
                    turn: {
                      critical: false,
                      crit_1_in: details.crit_1_in,
                      effects: details.effects.map((effect) => ({
                        ...effect,
                        value_max: effect.value,
                        critical_only: false,
                      })),
                    },
                  }}
                  disabled={false}
                  selected={false}
                  select={() => undefined}
                />
              )
            })}
            controls={<Button tone="primary">End turn</Button>}
          />
        </div>
        <div style={{ position: 'absolute', top: 20, right: 20, pointerEvents: 'auto' }}>
          <WorldQuickslots />
        </div>
      </div>
    </main>
  )
}
