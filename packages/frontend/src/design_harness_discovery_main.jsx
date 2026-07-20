// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THROWAWAY world&discovery design-pass harness — NOT part of the app, NOT imported by main.tsx, NOT built
// into the production bundle (a separate Vite HTML entry: design-harness-discovery.html). Per the
// PICK#3 ruling, World switcher and the top-strip Compass are ALREADY DECIDED
// (reuse the existing lobby-tab modal / option 3A picked+praised) — nothing to design there. What's left:
// the SEARCH ZONE button (shown only while a zone is unsearched) and the minimap's mob/resource overlay +
// click-to-enlarge affordance. Reuses the REAL `.gw-panel` class (blur/rounding/border) so the gold-terminal-
// only ruling is satisfied by construction, not eyeballed. Placeholder terrain background — the HUD chrome
// is the subject, not a voxel-art recreation.
//   ?opt=1  NPC-Prompt Match — byte-identical language to the shipped bottom-center .gw-npc-prompt — WON
//   ?opt=2  Radar Sweep — a segmented bar-button + pulsing ring, its own "discovery" identity
//   ?opt=3  Minimal Corner Tab — grouped with the minimap instead of the already-busy bottom-center
//   ?opt=4  ADDENDUM — option 1 + the PICK riders: 4-prompt stack + search progress toast
// Delete this file + design-harness-discovery.html + design_harness_discovery.css once the pick lands.
import './boot_shim'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Maximize2, Search } from 'lucide-react'

import './index.css'
import './game/screens/hud/world/game-world-hud.css'
import './design_harness_discovery.css'

// placeholder mob/resource positions on the 150x150 minimap canvas (px, within the 8px-inset map box)
const DOTS = [
  { kind: 'player', x: 65, y: 68 },
  { kind: 'mob', x: 40, y: 30 },
  { kind: 'mob', x: 88, y: 42 },
  { kind: 'resource', x: 30, y: 85 },
  { kind: 'resource', x: 100, y: 90 },
]

function Minimap({ variant }) {
  return (
    <div className="mmd-minimap gw-panel" aria-hidden="true">
      <span className="mmd-minimap__lbl">Map</span>
      <span className="mmd-minimap__expand">
        <Maximize2 size={11} strokeWidth={2} />
      </span>
      <div className="mmd-minimap__map">
        {DOTS.map((d, i) => (
          <span key={i} className={`mmd-minimap__dot mmd-minimap__dot--${d.kind}`} style={{ left: d.x, top: d.y }} />
        ))}
      </div>
      {variant === 3 && (
        <button
          type="button"
          className="mmd-search mmd3-search gw-panel"
          style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', whiteSpace: 'nowrap' }}
        >
          <Search size={11} strokeWidth={2.2} />
          Search This Zone
        </button>
      )}
    </div>
  )
}

function Option1() {
  return (
    <div className="mmd-stage">
      <span className="mmd-tag">Option 1 — NPC-Prompt Match</span>
      <button type="button" className="mmd-search mmd1-search gw-panel">
        <kbd className="mmd1-search__key">F</kbd>
        <span>Search This Zone</span>
      </button>
      <Minimap variant={1} />
    </div>
  )
}

function Option2() {
  return (
    <div className="mmd-stage">
      <span className="mmd-tag">Option 2 — Radar Sweep</span>
      <button type="button" className="mmd-search mmd2-search gw-panel">
        <span className="mmd2-search__ring">
          <Search size={10} strokeWidth={2.4} />
        </span>
        <span>Search This Zone</span>
        <span className="mmd2-search__ticks" aria-hidden="true">
          <span style={{ height: '40%' }} />
          <span style={{ height: '70%' }} />
          <span style={{ height: '100%' }} />
          <span style={{ height: '55%' }} />
        </span>
      </button>
      <Minimap variant={2} />
    </div>
  )
}

function Option3() {
  return (
    <div className="mmd-stage">
      <span className="mmd-tag">Option 3 — Minimal Corner Tab (grouped with the minimap)</span>
      <Minimap variant={3} />
    </div>
  )
}

// ── ADDENDUM (option 1 won) — riders: (1) 4 DISTINCT proximity prompts, AZERTY-safe, final
// bind TBD at implementation: Search=F (matches option 1), Enter Dungeon=E (shipped, NpcPrompt.jsx), Gather=
// G, Ride Pet=R. (2) they must ALL show together when multiple apply — a vertical stack in option 1's exact
// pill language, anchored at the SAME bottom-center spot the single pill already occupies (closest/most-
// actionable prompt stays at that anchor; others stack upward) so nothing jumps around as prompts come and
// go. (3) SEARCH ZONE now triggers a progress-bar toast ("a sound + progress-bar toast" — RP flavor,
// searching takes a beat) in the REAL top-right `.gw-toasts` stack (game-world-hud.css), not a new position.
function Option4() {
  const PROMPTS = [
    { key: 'F', label: 'Search This Zone' },
    { key: 'G', label: 'Gather' },
    { key: 'R', label: 'Ride Pet' },
    { key: 'E', label: 'Enter The Dungeons' }, // shipped NpcPrompt copy, verbatim
  ]
  return (
    <div className="mmd-stage">
      <span className="mmd-tag">Option 1 + PICK riders — stacked prompts &amp; search progress toast</span>

      {/* the real top-right toast stack — a progress-bar toast for the in-flight search */}
      <div className="gw-toasts" aria-hidden="true">
        <div className="gw-toast mmd-toast--progress">
          <div className="mmd-toast__head">
            <span className="gw-toast__dot" />
            <span>
              Searching Zone<b>…</b>
            </span>
          </div>
          <div className="mmd-toast__bar">
            <span />
          </div>
        </div>
      </div>

      {/* all 4 proximity prompts live at once — same pill, stacked, closest/most-actionable anchors bottom */}
      <div className="mmd4-stack">
        {PROMPTS.map((p) => (
          <button key={p.key} type="button" className="mmd4-row gw-panel">
            <kbd className="mmd4-row__key">{p.key}</kbd>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <Minimap variant={1} />
    </div>
  )
}

function Harness() {
  const opt = new URLSearchParams(window.location.search).get('opt') ?? '1'
  if (opt === '2') return <Option2 />
  if (opt === '3') return <Option3 />
  if (opt === '4') return <Option4 />
  return <Option1 />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
