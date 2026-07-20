// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const out = resolve(frontend, '../../docs/tmp_lane_N_shots')
const css = [
  'src/game/screens/hud/world/game-world-hud.css',
  'src/game/screens/hud/world/compass-strip.css',
  'src/game/screens/hud/minimap.css',
  'src/game/touch/touch-controls.css',
  'src/game/screens/hud/mobile-hud.css',
  'src/game/screens/hud/mobile-orientation.css',
]
  .map((path) => readFileSync(resolve(frontend, path), 'utf8'))
  .join('\n')

mkdirSync(out, { recursive: true })

const harness_css = `
  :root {
    --safe-top: 0px; --safe-right: 0px; --safe-bottom: 0px; --safe-left: 0px;
    --color-bg: #0a0a0f; --color-surface: #12121a; --color-border: #29293b;
    --color-gold: #c8963c; --color-gold-light: #f5d0a9; --color-gold-dark: #8b6914;
    --color-cyan: #4a9eff; --color-text: #e8e4dc; --color-muted: #7f8795;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #101622; }
  body { color: var(--color-text); font-family: var(--font-mono); }
  button { font: inherit; }
  .lane-n-world { position: fixed; inset: 0; overflow: hidden; background: linear-gradient(#638eb0 0 48%, #8cad8f 48% 100%); }
  .lane-n-world::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 52% 24%, transparent 0 22%, rgba(8,12,18,.18) 75%), linear-gradient(180deg, transparent 45%, rgba(4,9,10,.24)); }
  .lane-n-sun { position: absolute; top: 35px; left: 67%; width: 42px; height: 42px; border-radius: 50%; background: #f4dba1; box-shadow: 0 0 55px 20px rgba(244,219,161,.36); }
  .lane-n-mountain { position: absolute; left: -4%; right: -4%; bottom: 37%; height: 43%; background: #496b72; clip-path: polygon(0 100%,0 71%,12% 41%,22% 72%,35% 21%,49% 71%,62% 35%,76% 72%,89% 27%,100% 65%,100% 100%); }
  .lane-n-mountain::after { content: ''; position: absolute; inset: 19% 0 0; background: #395b60; clip-path: polygon(0 100%,0 75%,18% 42%,30% 77%,43% 32%,57% 76%,71% 45%,82% 76%,94% 43%,100% 66%,100% 100%); }
  .lane-n-ground { position: absolute; left: -16%; right: -16%; bottom: -34%; height: 86%; transform: perspective(360px) rotateX(58deg); transform-origin: top; background-color: #68855d; background-image: linear-gradient(rgba(28,49,35,.22) 2px, transparent 2px), linear-gradient(90deg, rgba(28,49,35,.22) 2px, transparent 2px), linear-gradient(135deg, rgba(255,255,255,.08), transparent 45%); background-size: 48px 48px, 48px 48px, 100% 100%; }
  .lane-n-path { position: absolute; left: 43%; bottom: -10%; width: 22%; height: 62%; transform: perspective(360px) rotateX(57deg); transform-origin: top; background: repeating-linear-gradient(90deg,#9b8c68 0 28px,#847657 29px 31px); clip-path: polygon(44% 0,56% 0,100% 100%,0 100%); opacity: .9; }
  .lane-n-tree { position: absolute; width: 22px; height: 64px; bottom: 28%; background: #654b32; box-shadow: inset -7px 0 rgba(0,0,0,.18); }
  .lane-n-tree::before, .lane-n-tree::after { content: ''; position: absolute; background: #315c3e; box-shadow: inset -12px -8px rgba(0,0,0,.16); }
  .lane-n-tree::before { width: 72px; height: 48px; left: -25px; top: -36px; }
  .lane-n-tree::after { width: 52px; height: 38px; left: -15px; top: -60px; }
  .lane-n-tree--a { left: 12%; transform: scale(.85); }
  .lane-n-tree--b { right: 16%; bottom: 30%; transform: scale(1.15); }
  .lane-n-tree--c { right: 34%; bottom: 39%; transform: scale(.55); }
  .lane-n-world-title { position: absolute; left: 50%; top: 52%; transform: translate(-50%,-50%); color: rgba(255,255,255,.18); font-size: 10px; letter-spacing: .38em; text-transform: uppercase; }
  .lane-n-map { width: 100%; height: 100%; display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }
  .lane-n-menu-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; }
  .lane-n-proof-label { position: fixed; top: 5px; left: 58px; z-index: 20000; color: rgba(255,255,255,.35); font-size: 6px; letter-spacing: .16em; text-transform: uppercase; pointer-events: none; }
`

const icon = (path) => `<svg class="lane-n-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`
const menu_icon = icon('M4 7h16M4 12h16M4 17h16')
const chat_icon = icon('M5 5h14v10H9l-4 4V5Z')
const graphics_icon = icon('M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4')
const globe_icon = icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c3 3 3 15 0 18m0-18c-3 3-3 15 0 18M3 12h18')
const sword_icon = icon('m5 19 4-4m-2 6-4-4L16 4l4 4L7 21Zm9-5 3 3')
const jump_icon = icon('m7 14 5-5 5 5m-10 5 5-5 5 5')
const mount_icon = icon('M6 17c1-4 3-7 6-9l2-4 3 4 3 2-3 3v6H9l-3-2Z')

const world = `
  <div class="lane-n-world" aria-hidden="true">
    <span class="lane-n-sun"></span><span class="lane-n-mountain"></span><span class="lane-n-ground"></span>
    <span class="lane-n-path"></span><span class="lane-n-tree lane-n-tree--a"></span>
    <span class="lane-n-tree lane-n-tree--b"></span><span class="lane-n-tree lane-n-tree--c"></span>
    <span class="lane-n-world-title">THE WORLD IS THE SCREEN</span>
  </div>`

const compass = `
  <div class="gw-compass-wrap">
    <div class="gw-compass gw-panel" aria-label="Compass">
      <div class="gw-compass__band">
        <div class="gw-compass__ruler"></div>
        <span class="gw-compass__card" style="left:12%">NW</span>
        <span class="gw-compass__card gw-compass__card--major" style="left:38%">N</span>
        <span class="gw-compass__card" style="left:67%">NE</span>
        <span class="gw-compass__fwd"><span class="gw-compass__caret"></span><span class="gw-compass__stem"></span></span>
        <span class="gw-compass__pip gw-compass__pip--resource gw-compass__pip--near" style="left:25%"><span class="gw-compass__pip-dot-row"><span class="gw-compass__pip-dot"></span></span></span>
        <span class="gw-compass__pip gw-compass__pip--mob gw-compass__pip--mid" style="left:61%"><span class="gw-compass__pip-dot-row"><span class="gw-compass__pip-dot"></span></span></span>
      </div>
      <span class="gw-compass__mobile-zone">ZONE 0·0</span>
      <span class="gw-compass__tod"><span class="gw-compass__tod-mark" style="left:64%"></span></span>
    </div>
    <button type="button" class="gw-npc-prompt gw-npc-prompt--stacked gw-panel"><span class="gw-npc-prompt__label">SEARCH THE ZONE</span></button>
  </div>`

const minimap = `
  <div class="mm"><button type="button" class="mm-lens" aria-label="Open map">
    <svg class="mm-canvas lane-n-map" viewBox="0 0 72 72">
      <path fill="#315c3e" d="M5 25 35 5l31 18-30 19Z"/><path fill="#294a38" d="m5 25 31 17v23L5 48Z"/>
      <path fill="#416d48" d="m35 5 31 18v22L36 65V42Z"/><path fill="#68855d" d="m17 24 18-11 19 11-19 11Z"/>
      <circle cx="38" cy="31" r="3" fill="#4a9eff" stroke="#07111b" stroke-width="1.5"/>
      <circle cx="24" cy="25" r="2" fill="#f87171"/><circle cx="51" cy="25" r="2" fill="#4ade80"/>
    </svg><span class="mm-scan"></span>
  </button></div>`

const identity = `
  <div class="gw-selfplate gw-panel">
    <div class="gw-selfplate__top"><span class="gw-selfplate__name">ASTRA</span><span class="gw-selfplate__lvl">LV 18</span></div>
    <div class="gw-selfplate__hp-row"><div class="gw-selfplate__hp-bar"><span class="gw-selfplate__hp-ghost" style="width:76%"></span><span class="gw-selfplate__hp-fill" style="width:76%"></span></div><span class="gw-selfplate__hp-t">82/108</span></div>
    <div class="gw-selfplate__xp-row"><div class="gw-selfplate__xp-bar"><span class="gw-selfplate__xp-fill" style="width:43%"></span></div><span class="gw-selfplate__xp-t">430/1000</span></div>
  </div>`

const touch_controls = `
  <div class="touch-controls"><div class="touch-controls__cluster">
    <button class="touch-controls__btn touch-controls__btn--jump">${jump_icon}<span class="touch-controls__btn-label">JUMP</span></button>
    <button class="touch-controls__btn touch-controls__btn--mount">${mount_icon}<span class="touch-controls__btn-label">MOUNT</span></button>
  </div></div>`

const menu = `
  <div class="mobile-hud-drawer-backdrop">
    <section class="mobile-hud-drawer" data-mobile-drawer="menu" role="dialog" aria-modal="true" aria-label="Navigation">
      <button class="mobile-hud-drawer__handle" aria-label="Close"><span></span></button>
      <header class="mobile-hud-drawer__header"><span></span><h2>Navigation</h2><button class="mobile-hud-drawer__close">×</button></header>
      <div class="mobile-hud-drawer__body"><div class="mobile-hud-menu">
        <div class="mobile-hud-menu__utilities">
          <button>${chat_icon}<span>Chat</span></button><button>${graphics_icon}<span>Graphics</span></button>
          <button>${globe_icon}<span>Worlds</span></button><button>${sword_icon}<span>Fights</span></button>
        </div>
        <nav class="mobile-hud-menu__nav" aria-label="Navigation">
          <button class="is-active">${menu_icon}<span>World</span></button><button>${menu_icon}<span>Characters</span></button>
          <button>${menu_icon}<span>Inventory</span></button><button>${menu_icon}<span>Encyclopedia</span></button>
        </nav>
      </div></div>
    </section>
  </div>`

const hud = (menu_open = false) => `${world}
  <div class="gw-hud gw-hud--mobile">
    ${compass}
    <div class="mobile-hud-actions"><button class="mobile-hud-button mobile-hud-button--menu" aria-label="Menu">${menu_icon}<span class="mobile-hud-button__label">Menu</span></button></div>
    ${minimap}${identity}
    <div class="gw-prompt-stack"><button class="gw-npc-prompt gw-npc-prompt--stacked gw-panel"><span class="gw-npc-prompt__label">ENTER THE DUNGEONS</span></button></div>
    ${menu_open ? menu : ''}
  </div>${touch_controls}<span class="lane-n-proof-label">LANE N2 · SHIPPED MOBILE CSS · 844 × 390 @2×</span>`

const portrait = `${world}<div class="gw-hud gw-hud--mobile"><div class="mobile-orientation-overlay" role="dialog" aria-modal="true" data-mobile-orientation-overlay="portrait"><div class="mobile-orientation-overlay__card"><span class="mobile-orientation-overlay__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2" fill="none" stroke="currentColor"/><path d="M10 18h4" stroke="currentColor"/></svg><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><strong>Rotate your device</strong><span>AresRPG uses landscape mode to keep the world visible.</span></div></div></div><span class="lane-n-proof-label">LANE N2 · PORTRAIT FALLBACK · 390 × 844 @2×</span>`

async function shot(browser, { width, height, markup, name }) {
  const context = await browser.newContext({
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${harness_css}\n${css}</style></head><body>${markup}</body></html>`
  )
  await page.screenshot({ path: resolve(out, name), animations: 'disabled' })
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await shot(browser, { width: 844, height: 390, markup: hud(false), name: 'world_hud_idle_844x390@2x.png' })
  await shot(browser, { width: 844, height: 390, markup: hud(true), name: 'menu_sheet_open_844x390@2x.png' })
  await shot(browser, { width: 390, height: 844, markup: portrait, name: 'portrait_rotate_overlay_390x844@2x.png' })
} finally {
  await browser.close()
}

console.log(`3 screenshots written to ${out}`)
