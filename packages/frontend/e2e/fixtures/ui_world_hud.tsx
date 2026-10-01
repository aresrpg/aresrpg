// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app, read_app_state } from '../../src/store.ts'
import { adventure_character_row, adventure_inventory } from '../../src/adventure/projection.ts'
import { MobileWorldHud } from '../../../mobile/src/MobileWorldHud.tsx'
import '../../../mobile/src/mobile.css'
import { toast } from '../../src/toast.ts'
import { JOURNEY_QUESTS } from '../../src/journey/model.ts'
import { content_catalog } from '../../src/content/catalog.ts'
import { TutorialHost } from '../../src/tutorial/TutorialHost.tsx'
import { Toasts } from '../../src/components/Toasts.tsx'
import { DesktopWorldHud } from '../../src/components/DesktopWorldHud.tsx'
import { DesktopWorldStatus } from '../../src/components/DesktopWorldStatus.tsx'
import { GamePageWindow } from '../../src/components/GamePageWindow.tsx'
import { publish_pose, read_pose } from '../../src/game/core/pose_feed.ts'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'
import '../../src/components/app_layout.css'
import '../../src/game/hud/world_responsive.css'

// Synthetic reducer inputs; no wallet connection or transaction execution. Public read-only widgets keep their normal lifecycle.
const mobile = new URLSearchParams(location.search).has('mobile')
const Hud = mobile ? MobileWorldHud : DesktopWorldHud
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'adventure/entered' })
const seed = adventure_character_row(read_app_state().adventure.character!)
const characters = ['Senshi', 'Rin', 'Kaori'].map((name, index) => ({
  ...seed,
  id: `character-${index}`,
  name,
  custody: 'kiosk' as const,
  checkpoint_world: 'nauvis',
  at_ms: 0,
  x: 50000,
  z: 50000,
}))
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: DEFAULT_ADMIN_ADDRESS } as never })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters } })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/server_info',
    online: 6,
    indexing_lag: 0,
    current_epoch: '1',
    chain_timestamp_ms: null,
    chain_sample_age_ms: null,
  },
})
dispatch_app({
  type: 'wallet/refreshed',
  balance_mist: 12_420_000_000n,
  kares_balance: 12_345_000_000_000n,
  gas_spent_mist: 0n,
})
dispatch_app({ type: 'character/select', character_id: characters[0]!.id })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/party',
    character_id: characters[0]!.id,
    party: {
      id: 'party',
      invited: [],
      members: ['Senshi', 'Rin', 'Kaori', 'Yuki', 'Moka', 'Haru'].map((name, index) => ({
        name,
        character_id: `character-${index}`,
      })),
    },
  },
})
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/tracked_zones',
    character_id: characters[0]!.id,
    world: 'nauvis',
    zones: [{ zx: 97, zz: 97 }],
  },
})
for (const [index, distance] of [12, 45].entries())
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/fight_created',
      fight: {
        id: `fight-${index}`,
        world: 'nauvis',
        x: 50000 + distance,
        z: 50000,
        phase: 'placement',
        access_a: 0,
        access_b: 0,
        opener_a: null,
        opener_b: null,
        managed: false,
        wagered: false,
        placement_ms: String(Date.now()),
      },
    },
  })
dispatch_app({ type: 'dialog/open', dialog: null })
if (new URLSearchParams(location.search).has('arena'))
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/kolizeums',
      lobbies: ([1, 3, 6] as const).map((format, index) => ({
        id: `arena-${index}`,
        fight: '',
        creator: '0x123456789abcdef',
        format,
        pledge_mist: '1000000000',
        pot_mist: '1000000000',
        level_min: 100,
        level_max: 200,
        public: true,
        can_join: true,
        status: 'open',
        fighters: Array.from({ length: format * 2 }, (_, seat) => ({
          seat,
          team: seat < format ? 0 : 1,
          character_id: `other-${seat}`,
          name: `Rin ${seat + 1}`,
          classe: 'rojin',
          level: 170,
          settled: false,
        })),
      })),
    },
  })
if (new URLSearchParams(location.search).has('guest')) dispatch_app({ type: 'auth/disconnected' })
if (new URLSearchParams(location.search).has('hud-layout')) {
  const { journey } = read_app_state()
  dispatch_app({
    type: 'journey/loaded',
    identity: journey.identity!,
    generation: journey.generation,
    completed: JOURNEY_QUESTS.map(({ id }) => id),
  })
}
if (new URLSearchParams(location.search).has('tutorial'))
  dispatch_app({ type: 'engine/status', status: { state: 'ready', backend: 'webgpu' } })
if (new URLSearchParams(location.search).has('listings'))
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/listings',
      kiosk_versions: { kiosk: '1' },
      listings: adventure_inventory(content_catalog.items.slice(0, 60)).map((item, index) => ({
        ...item,
        id: `listing-${index}`,
        kind: 'item' as const,
        version: '1',
        seller: DEFAULT_ADMIN_ADDRESS,
        kiosk: 'kiosk',
        price_mist: '1000000000',
        at_ms: 0,
        amount: 1,
      })),
    },
  })
publish_pose({ character_id: characters[0]!.id, x: 0, y: 0, z: 0, yaw: 0, riding: false, time_of_day: 0.5 })
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">
    <main
      className={`app-ui ${mobile ? 'mobile-app' : ''}`}
      style={{ position: 'fixed', inset: 0, background: '#29302e' }}
    >
      <div data-world-frame="" className="app-world-frame" style={{ position: 'absolute' }}>
        <Hud copy={copy} />
        <div style={{ position: 'absolute', inset: 0, padding: 12, pointerEvents: 'none', zIndex: 110 }}>
          <DesktopWorldStatus copy={copy} />
        </div>
      </div>
      <GamePageWindow copy={copy} />
      <Toasts />
      {new URLSearchParams(location.search).has('tutorial') && <TutorialHost blocked={false} copy={copy} />}
      <button hidden data-test-notification onClick={() => toast.persistent('HUD verification', 'info')}>
        Notify
      </button>
      <button
        hidden
        data-test-rotate
        onClick={() => {
          const pose = read_pose()!
          publish_pose({ ...pose, yaw: pose.yaw + 0.5 })
        }}
      >
        Rotate
      </button>
      <button
        hidden
        data-test-move
        onClick={() => {
          const pose = read_pose()!
          publish_pose({ ...pose, x: pose.x + 9 })
        }}
      >
        Move
      </button>
      <button
        hidden
        data-test-travel
        onClick={() => {
          const pose = read_pose()!
          publish_pose({ ...pose, x: pose.x + 128 })
        }}
      >
        Travel
      </button>
    </main>
  </LocaleScope>
)
