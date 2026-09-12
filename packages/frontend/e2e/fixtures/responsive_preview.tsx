// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local presentation fixture. No game observers, signer, or transaction executor are started.
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight } from '@aresrpg/fight'
import { item_stat_center, job_xp_for_level } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

import { App } from '../../src/app.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, read_app_state } from '../../src/store.ts'
import { market_observation } from '../../src/modules/marketplace.ts'
import { TUTORIAL_IDS } from '../../src/tutorial/tutorial.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import { FightHud } from '../../src/game/fight/FightHud.tsx'
import '../../src/tailwind.css'
import './responsive_preview.css'

const params = new URLSearchParams(location.search)
const page = params.get('page') ?? 'settings'
document.documentElement.dataset.previewDensity = params.get('density') ?? 'current'
const copy = await load_app_copy('en')
const address = '0x' + 'aa'.repeat(32)
const character: CharacterRow = {
  id: '0xpreview',
  name: 'Aster',
  classe: 'senshi',
  sex: 'female',
  level: 20,
  experience: '6000',
  color_1: 0xb38540,
  color_2: 0x507d83,
  color_3: 0xc4b0a3,
  vitality: 35,
  wisdom: 12,
  strength: 45,
  intelligence: 10,
  chance: 5,
  agility: 8,
  available_points: 15,
  available_spell_points: 8,
  spells: {},
  jobs: {
    HERBALIST: String(job_xp_for_level(15)),
    FARMER: String(job_xp_for_level(10)),
    TAILOR: String(job_xp_for_level(8)),
  },
  kiosk: '0xpreviewkiosk',
  custody: 'kiosk',
  equipment: [],
  world: 'nauvis',
  checkpoint_world: 'nauvis',
  x: 50000,
  z: 50000,
  at_ms: 0,
  hp: '150',
  hp_ms: Date.now(),
}
const selected_types = [
  ...new Set([
    ...content_catalog.items
      .filter(({ category }) => ['hat', 'cloak', 'amulet', 'ring', 'sword', 'boots', 'belt', 'pet'].includes(category))
      .slice(0, 20)
      .map(({ item_type }) => item_type),
    ...content_catalog.items
      .filter(({ category }) => category === 'resource')
      .slice(0, 18)
      .map(({ item_type }) => item_type),
    'green_mushroom',
    'water',
    'croissant',
    'recall_potion',
    'rune_strength_ba',
    'rune_vitality_ba',
  ]),
]
const items: ItemRow[] = selected_types.flatMap((type, index) => {
  const seed = content_catalog.item(type)?.item
  return seed
    ? [
        {
          id: `0xitem${index}`,
          name: seed.name,
          item_type: type,
          category: seed.category,
          level: seed.level,
          amount: ['resource', 'consumable', 'rune'].includes(seed.category) ? 48 : 1,
          kiosk: character.kiosk,
          ...(seed.stats ? { stats: { strength: item_stat_center + 24, vitality: item_stat_center + 38 } } : {}),
        },
      ]
    : []
})
const settings = {
  ...read_app_state().settings,
  music_enabled: false,
  footsteps_enabled: false,
  completed_tutorials: TUTORIAL_IDS,
  marketplace_disclaimer_acknowledged: true,
}
dispatch_app({ type: 'settings/changed', settings })
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: { address, suins: { snapshot: async () => ({ default_name: 'aster.aster.sui', names: [] }) } } as never,
})
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/characters',
    characters: [character, { ...character, id: '0xalt', name: 'Nyx', classe: 'shugo', level: 14 }],
  },
})
dispatch_app({ type: 'character/select', character_id: character.id })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items } })
dispatch_app({
  type: 'wallet/refreshed',
  balance_mist: 42500000000n,
  kares_balance: 1250000000000n,
  gas_spent_mist: 0n,
})
dispatch_app({ type: 'server/packet', packet: { type: 'packet/game_state', frozen: false } })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/server_info',
    online: 42,
    indexing_lag: 0,
    current_epoch: '1250',
    chain_timestamp_ms: Date.now(),
    chain_sample_age_ms: 0,
    market_volume: { epoch: '1250', mist: '1284500000000' },
  },
})
dispatch_app({ type: 'engine/status', status: { state: 'ready', backend: 'webgpu' } })
const routes: Record<string, string> = {
  equipment: '/characters/equipment',
  stats: '/characters/stats',
  spells: '/characters/spells',
  jobs: '/characters/jobs?job=HERBALIST',
  runeforge: '/characters/runeforge',
  marketplace: '/marketplace',
  settings: '/settings',
  mastery: '/mastery',
  airdrop: '/airdrop',
  encyclopedia: '/encyclopedia/items',
  leaderboard: '/leaderboard',
  kolizeum: '/kolizeum',
  world: '/world',
  fight: '/world',
  dungeon: '/world',
}
dispatch_app({ type: 'path/open', pathname: routes[page] ?? '/settings' })
dispatch_app({ type: 'dialog/open', dialog: null })
if (page === 'marketplace') {
  const hat = content_catalog.items.find(({ category }) => category === 'hat')!
  dispatch_app({ type: 'market/group_selected', group: 'EQUIPMENT' })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/market_slice',
      observation: market_observation('EQUIPMENT'),
      kiosk_versions: { '0xvendor': '1' },
      listings: [1, 2, 3, 4, 5].map((i) => ({
        version: '1',
        kind: 'item',
        id: `0xoffer${i}`,
        name: hat.name,
        item_type: hat.item_type,
        category: hat.category,
        level: hat.level,
        amount: 1,
        price_mist: String(i * 1250000000),
        kiosk: '0xvendor',
        seller: '0xother',
        at_ms: i,
        stats: { strength: item_stat_center + i * 7 },
      })),
    },
  })
}
if (page === 'mastery')
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/mastery',
      mastery: {
        id: '0xmastery',
        owner: address,
        points: '24',
        last_completed_epoch: '1249',
        quest_epoch: '1250',
        quest_started_ms: String(Date.now()),
        quest_world: 'nauvis',
        quest_dungeon: content_catalog.dungeons[0]!.dungeon,
        quest_reward: 1,
        quest_completed: false,
      },
      offers: [],
    },
  } as never)
if (page === 'leaderboard') {
  const { observation } = read_app_state().leaderboards
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/leaderboard',
      snapshot: {
        observation,
        reset_at_ms: Date.now() + 12 * 86400000,
        timestamp_ms: Date.now(),
        checkpoint: 123,
        entries: Array.from({ length: 30 }, (_, i) => ({
          address: `0xrank${i}`,
          name: ['aster.sui', 'nyx.sui', 'kael.sui'][i] ?? null,
          rank: i + 1,
          score: String(250000 - i * 3241),
          characters: [{ name: ['Aster', 'Nyx', 'Kael'][i % 3]!, classe: 'senshi', level: 20 + i }],
          character_count: 1,
          jobs: [{ job: 'FARMER', level: 30 }],
        })),
        self: null,
      },
    },
  })
}
for (const [index, line] of [
  'Anyone heading to Ivory Rampart?',
  'I can join after gathering some mushrooms.',
  'Nice rolls on that Fuwa Hat!',
].entries())
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/chat_message',
      channel: 'world',
      scope: 'nauvis',
      from: '0xfriend',
      character_id: `0xfriend${index}`,
      character: ['Nyx', 'Aster', 'Kael'][index]!,
      parts: [{ kind: 'text', text: line }],
    },
  })
publish_pose({ character_id: character.id, x: 1100, y: 0, z: 1100, yaw: 0.6, riding: false, time_of_day: 0.38 })
if (page === 'dungeon') {
  const { dungeon } = content_catalog.dungeons[0]!
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [{ ...character, dungeon_run: { dungeon, room: 1 } }] },
  })
}
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
const Annotate = () => {
  useEffect(() => {
    const sidebar = document.querySelector('[data-app-sidebar]')
    const column = sidebar?.parentElement?.parentElement
    if (column) {
      column.dataset.previewSidebarColumn = ''
      const shell = column.parentElement?.parentElement
      if (shell) shell.dataset.previewShell = ''
    }
  }, [])
  return null
}
createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <Annotate />
    {page === 'fight' && (
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
    )}
  </>
)
document.body.dataset.previewPage = page
