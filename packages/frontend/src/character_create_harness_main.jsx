// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THROWAWAY landscape-fit verification harness (character-creation phone-landscape ticket) — NOT part of
// the app, NOT imported by main.tsx, NOT built into the production bundle (a separate Vite HTML entry:
// character-create-harness.html). Mounts the REAL character_create() screen imperatively — the same module
// the app uses, same CSS, same GLB pedestal — with no chain, no auth, no roster, so Playwright can drive
// real viewports against real DOM/CSS. `?placement=inline` (default) reproduces the confirmed-empty
// onboarding host (WorldCharacterCreate.jsx mounts `.world-character-create` at z-index 80) WITH the real
// mobile-hud FAB markup/CSS (mobile-hud.css, `.mobile-hud-actions` z-index 90) alongside it — GameWorldHud
// mounts MobileHud unconditionally, roster state or not, so the FAB genuinely overlays this host in
// production and the harness must reproduce that to answer the clearance question honestly.
// `?placement=overlay` mounts the secondary-character full-screen modal instead (CharactersDrawer's "add a
// character" path, z-index 1000 — already above the FAB). Delete this file + the .html entry once the
// landscape-fit ticket is signed off.
import './boot_shim'

import './index.css'
import './i18n'
import './game/screens/hud/mobile-hud.css'
import { character_create } from './game/screens/character-create.js'

const params = new URLSearchParams(window.location.search)
const placement = params.get('placement') === 'overlay' ? 'overlay' : 'inline'
const show_fab = placement === 'inline' && params.get('fab') !== '0'

// The positioned ancestor both `.world-character-create` (absolute/inset:0) and `.mobile-hud-actions`
// (absolute) size against — mirrors GameWorldHost's full-bleed frame.
const stage = document.createElement('div')
stage.style.position = 'fixed'
stage.style.inset = '0'
document.getElementById('root').appendChild(stage)

const host = document.createElement('div')
if (placement === 'inline') host.className = 'world-character-create'
stage.appendChild(host)

if (show_fab) {
  // Real markup/CSS of MobileHud's unconditional menu FAB (MobileHud.jsx) — reproduced here rather than
  // mounting the whole HUD tree (which needs the full store/auth/chain context this harness deliberately
  // skips). Same classes, same stylesheet, so the z-index/position truth is real, not asserted.
  const fab_wrap = document.createElement('div')
  fab_wrap.className = 'mobile-hud-actions'
  fab_wrap.innerHTML =
    '<button type="button" class="mobile-hud-button mobile-hud-button--menu" aria-label="Menu">' +
    '<span style="width:17px;height:17px;display:block;border:1px solid currentColor" aria-hidden="true"></span>' +
    '<span class="mobile-hud-button__label">Menu</span>' +
    '</button>'
  stage.appendChild(fab_wrap)
}

const handle = character_create({
  placement,
  character_count: 0,
  claimed_free: false,
  zklogin_session: true,
  cancel_label: 'Log out',
  on_created: async () => {},
  on_cancel: () => {},
})
host.appendChild(handle.root)
