// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THROWAWAY S-25 verification harness — NOT part of the app, NOT imported by main.tsx, NOT built into the
// production bundle (a separate Vite HTML entry: design-harness.html). It now renders the SHIPPED optE bar:
// the REAL <DeckCluster/> (the fixed socket grid + real pager) inside the real `.hud-spellbar--optE` skeleton,
// beside a byte-identical clone of GameWorldHud's private Vitals/XP markup (those two aren't exported), seeded
// with a synthetic fight via the SAME window.__ARES_ENGINE-shaped context.dispatch the game.js file documents
// as the sanctioned Playwright-harness seam. URL params drive the verification states:
//   ?hand=<n>   how many spells in the hand (default 8) — use 3 for the empty-socket state, 25 for pagination
//   ?armed=<n>  preview the picked/armed glow on slot n (0 = weapon, 1-9 = hand card)
// No chain writes, no WS, no auth. Delete this file + design-harness.html once S-25 lands.
import './boot_shim'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { fight_store } from '@aresrpg/fight/store'

import './index.css'
import './game-tab.css'
import './game/screens/hud/hud.css'
import './game/screens/hud/world/game-world-hud.css'
import './i18n'
import { use_fight_view } from './game/store.js'
import { DeckCluster } from './game/screens/hud/DeckCluster.jsx'
import { fight_spells_data, resolve_class_spells } from './game/screens/hud/fight-spells.js'

// The REAL on-chain hand — the SAME resolver DungeonBoard seeds fight.hand with (class + unlock ≤ level →
// seeded SpellTemplate rows). Default `?hand=` (unset) renders exactly what a level-10 senshi gets in a fight
// (the 3 seeded spells); an explicit ?hand=<n> cycles the pool to n for layout states. The senshi 3-spell
// pool is PADDED with the other classes' seeded name_keys (unique ids, and spell_card resolves any seeded
// key) so the FIXED bar's full-9 state (?hand=9, 07-11 two-row refinement) is screenshot-able.
const SENSHI = resolve_class_spells('senshi', 10).map((sp) => sp.name_key)
const POOL = [
  ...SENSHI,
  ...fight_spells_data.spells.map((spell) => spell.name_key).filter((key) => !SENSHI.includes(key)),
]

/** Byte-identical clone of GameWorldHud.jsx's private Vitals (fight branch) — same `.hud-vbox` markup so the
 * real optE CSS applies unchanged: the 2× HP gem (percent, or click-toggled current/max fraction) + stacked
 * AP/MP gems. Seeded from the fight. `?frac=1` forces the fraction state open for screenshotting either. */
function VitalsPreview() {
  const params = new URLSearchParams(window.location.search)
  const fight = use_fight_view() // synchronous core view (S2 mirror kill — the dead WS bus never fed the copy)
  const me = fight && fight.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
  const health = me?.health ?? 0
  const max_health = me?.health_max ?? 1
  const hp_pct = max_health > 0 ? Math.round(Math.max(0, Math.min(100, (health / max_health) * 100))) : 0
  const ap = me?.ap ?? 0
  const mp = me?.mp ?? 0
  const [show_fraction, set_show_fraction] = useState(params.get('frac') === '1')
  return (
    <div className="hud-vbox">
      <div className="hud-vbox__hp">
        <button
          type="button"
          className="hud-gem-bezel"
          aria-pressed={show_fraction}
          aria-label={`HP ${show_fraction ? `${health} / ${max_health}` : `${hp_pct}%`} — click to toggle`}
          onClick={() => set_show_fraction((v) => !v)}
        >
          <div className="hud-gem2 hud-gem2--hp">
            <div className="hud-gem2__rim" />
            <div className="hud-gem2__facets" />
            <div className="hud-gem2__spec" />
            {show_fraction ? (
              <span className="hud-gem2__frac">
                <span className="hud-gem2__frac-n">{health}</span>
                <span className="hud-gem2__frac-bar" />
                <span className="hud-gem2__frac-n">{max_health}</span>
              </span>
            ) : (
              <span>{hp_pct}%</span>
            )}
          </div>
        </button>
      </div>
      <div className="hud-vbox__side">
        <div className="hud-gem2 hud-gem2--ap hud-gem2--stat" aria-hidden="true">
          <div className="hud-gem2__rim" />
          <div className="hud-gem2__fill" />
          <span>{ap}</span>
        </div>
        <div className="hud-gem2 hud-gem2--mp hud-gem2--stat" aria-hidden="true">
          <div className="hud-gem2__rim" />
          <div className="hud-gem2__fill" />
          <span>{mp}</span>
        </div>
      </div>
    </div>
  )
}

function Harness() {
  const params = new URLSearchParams(window.location.search)
  // default = the FULL real hand (3 on-chain senshi spells); ?hand=<n> trims it (n ≤ pool — the bar is
  // data-driven now, no empty sockets and no pager, and DeckCluster keys sockets by unique spell id).
  const hand_size = Math.min(POOL.length, Math.max(0, Number(params.get('hand') ?? POOL.length) || 0))
  const armed_slot = params.get('armed') // e.g. '1' to preview the picked glow on hand card 1
  // XP strip + level clone (production binds these to xp_progress(character) / expedition; the harness has no
  // character, so it reproduces the reference numbers for the screenshot — the real binding is tsc-verified).
  const level = Number(params.get('level') ?? '12') || 12
  const xp_pct = Number(params.get('xp') ?? '42') || 0

  useEffect(() => {
    // Seed the REAL fight core through its ONE door (S2 mirror kill: the old `action/fight/*` bus is dead) —
    // the same init → snapshot → hand_update → arm sequence a live dungeon shim drives, so DeckCluster and
    // the vitals render from genuine core projections.
    const { input } = fight_store.getState()
    input({ type: 'init', fight_id: 'design-preview', my_key: 'p0', ctx: { my_entity_id: 'me' } })
    input({
      type: 'snapshot',
      version: 1,
      fight: {
        id: 'design-preview',
        status: 1,
        width: 1,
        height: 1,
        participants: [
          {
            owner: '0xme',
            character: 'me',
            team: 0,
            ap: 6,
            mp: 3,
            base_ap: 6,
            base_mp: 3,
            hp: 85,
            max_hp: 120,
            cell: 0,
          },
        ],
        mobs: [],
        queue: [{ is_mob: false, idx: 0 }],
        turn_ptr: 0,
        turn_deadline_ms: 0,
      },
    })
    const hand = POOL.slice(0, hand_size)
    input({ type: 'hand_update', hand })
    if (armed_slot) {
      const idx = Number(armed_slot)
      const spell_id = idx === 0 ? '__weapon_attack' : POOL[(idx - 1) % POOL.length]
      if (spell_id) input({ type: 'arm', spell_id })
    }
  }, [hand_size, armed_slot])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0a0a0f' }}>
      <div className="hud-root gw-tab gw-fight-layer">
        {/* the shipped optE skeleton (mirrors GameWorldHud's SpellBar) around the REAL DeckCluster */}
        <div className="hud-spellbar hud-spellbar--optE">
          <div className="hud-spellbar2__top">
            <VitalsPreview />
            <DeckCluster />
          </div>
          <div className="hud-xprow" aria-hidden="true">
            <div className="hud-xpstrip2">
              <span style={{ width: `${xp_pct}%` }} />
            </div>
            <span className="hud-xplvl hud-num">{level}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
