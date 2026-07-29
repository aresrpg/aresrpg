// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

const hud_css = readFileSync(
  new URL('../../../packages/frontend/src/game/screens/hud/hud.css', import.meta.url),
  'utf8'
)
const mobile_css = readFileSync(
  new URL('../../../packages/frontend/src/game/screens/hud/mobile-fight-hud.css', import.meta.url),
  'utf8'
)
const mobile_hud_css = readFileSync(
  new URL('../../../packages/frontend/src/game/screens/hud/mobile-hud.css', import.meta.url),
  'utf8'
)
const game_world_hud_css = readFileSync(
  new URL('../../../packages/frontend/src/game/screens/hud/world/game-world-hud.css', import.meta.url),
  'utf8'
)
const index_html = readFileSync(new URL('../../../packages/frontend/index.html', import.meta.url), 'utf8')
const result_css = readFileSync(
  new URL('../../../packages/frontend/src/game/screens/hud/result.css', import.meta.url),
  'utf8'
)

test('iPhone landscape fight chrome is compact and keeps READY/FORFEIT inside the safe edge', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.setContent(`
    <style>
      :root {
        --safe-top: 0px;
        --safe-right: 47px;
        --safe-bottom: 0px;
        --safe-left: 47px;
        --game-viewport-left: 47px;
        --game-viewport-width: 750px;
        --ui-scale: 1;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; }
      ${hud_css}
      ${mobile_hud_css}
      ${mobile_css}
    </style>
    <div
      data-testid="game-world-viewport"
      style="position: fixed; left: var(--game-viewport-left); width: var(--game-viewport-width); height: 390px; overflow: hidden"
    >
      <canvas style="position: absolute; inset: 0; width: 100%; height: 100%; display: block"></canvas>
    </div>
    <div class="hud-root gw-tab gw-fight-layer gw-fight-layer--mobile">
      <div class="hud-turns">
        <div class="hud-turn ally">
          <div class="hud-turn__portrait">A</div>
          <div class="hud-turn__body"><span class="hud-turn__name">Ares</span><div class="hud-turn__hp"></div></div>
        </div>
      </div>
      <div class="hud-placement">
        <span class="hud-placement__title">POSITION YOUR TEAM</span>
        <span class="hud-placement__timer">0:55</span>
        <span class="hud-placement__hint">Tap a highlighted start cell</span>
      </div>
      <div class="hud-spellbar">
        <div class="hud-spellbar2__top">
          <div class="hud-vbox"><div class="hud-gem-bezel"></div></div>
          <div class="hud-socketgrid">${'<button class="hud-socket"></button>'.repeat(10)}</div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-fightctl">
          <span class="hud-fightctl__countdown">FIGHT STARTS IN 5</span>
          <button class="hud-fightctl__btn hud-fightctl__ready">READY</button>
          <button class="hud-fightctl__btn hud-fightctl__abandon">FORFEIT</button>
        </div>
      </div>
    </div>
  `)

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    const style = (selector: string) => getComputedStyle(document.querySelector(selector) as Element)
    return {
      viewport: rect('[data-testid="game-world-viewport"]'),
      canvas: rect('[data-testid="game-world-viewport"] canvas'),
      turn: rect('.hud-turn'),
      socket: rect('.hud-socket'),
      placement_direction: style('.hud-placement').flexDirection,
      ready: rect('.hud-fightctl__ready'),
      forfeit: rect('.hud-fightctl__abandon'),
    }
  })

  const covered_viewport = await page.evaluate(() => {
    document.documentElement.style.setProperty('--game-viewport-left', '0px')
    document.documentElement.style.setProperty('--game-viewport-width', '844px')
    return document.querySelector('[data-testid="game-world-viewport"]')?.getBoundingClientRect().toJSON()
  })

  expect(index_html.match(/viewport-fit=cover/g)).toHaveLength(1)
  expect(geometry.viewport?.left).toBe(0)
  expect(geometry.viewport?.right).toBe(844)
  expect(geometry.canvas?.left).toBe(0)
  expect(geometry.canvas?.right).toBe(844)
  expect(geometry.turn?.left).toBeGreaterThanOrEqual(47)
  expect(geometry.turn?.width).toBeLessThanOrEqual(104)
  expect(geometry.socket?.width).toBeLessThanOrEqual(36)
  expect(geometry.placement_direction).toBe('row')
  expect(geometry.ready?.right).toBeLessThanOrEqual(797)
  expect(geometry.forfeit?.right).toBeLessThanOrEqual(797)
  expect(covered_viewport?.left).toBe(0)
  expect(covered_viewport?.right).toBe(844)
})

// PLAYER REPORT (mobile prod, v1.12.26, REPEAT): "the toast is still full width" — the in-game event-toast
// (.gw-toast, GameWorldHud.jsx's local Toasts()). Proves the REAL layout engine wraps a long title+message
// instead of overflowing past the safe-viewport cap, not just that the CSS text contains the right
// declarations (unit-tested separately, mobile_layout.test.jsx).
test('iPhone landscape in-game toast wraps long text within the safe viewport instead of overflowing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.setContent(`
    <style>
      :root { --safe-top: 0px; --safe-right: 47px; --safe-bottom: 0px; --safe-left: 47px; }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; }
      ${game_world_hud_css}
      ${mobile_hud_css}
    </style>
    <html class="ares-mobile-hud">
    <div class="gw-hud gw-hud--fight gw-hud--mobile">
      <div class="gw-toasts">
        <div class="gw-toast">
          <span class="gw-toast__dot"></span>
          <span>Whisperwood Cache <b>A Gleaming Ironbound Warhammer of the Ancient Deepforge Clan dropped</b></span>
        </div>
      </div>
    </div>
  `)

  const geometry = await page.evaluate(() => {
    const toast = document.querySelector('.gw-toast') as HTMLElement
    return {
      viewport_width: window.innerWidth,
      rect: toast.getBoundingClientRect().toJSON(),
      scroll_height: toast.scrollHeight,
      // a single line of this 9px mono text is ~12-14px tall; anything past ~20px proves it wrapped.
      single_line_height: 20,
    }
  })

  // never rides past the visible screen edge (a "full width" overflow past the safe-right notch inset)
  expect(geometry.rect.right).toBeLessThanOrEqual(geometry.viewport_width)
  expect(geometry.rect.right).toBeLessThanOrEqual(844 - 47)
  // the long fixture text genuinely wrapped to multiple lines rather than forcing the box wider
  expect(geometry.scroll_height).toBeGreaterThan(geometry.single_line_height)
})

// PLAYER REPORT (mobile prod): the fight-end result card overflowed the viewport with CONTINUE below the
// fold — "can't click through it" (a full party + enemy roster + spoils render at desktop height with no
// cap). Proves the REAL layout engine keeps CONTINUE reachable on a small iPhone-class portrait viewport,
// not just that the CSS text contains the right declarations (unit-tested separately, mobile_layout.test.jsx).
test('iPhone portrait fight-end card keeps CONTINUE reachable and compacts the roster rows', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const fighter_row = (label: string, mine: boolean) => `
    <div class="fe-row fe-row--alive${mine ? ' is-you' : ''}">
      <div class="fe-row__glyph">${label[0]}</div>
      <div class="fe-row__id">
        <div class="fe-row__name">${label} the Adventurer${mine ? '<span class="fe-you">YOU</span>' : ''}</div>
        <div class="fe-row__sub">Warrior · Lv 42</div>
      </div>
      <div class="fe-hp"><span class="fe-hp__fill" style="width:100%"></span></div>
      <div class="fe-state fe-state--alive">ALIVE</div>
    </div>`
  const party = ['Ares', 'Kestrel', 'Thorne', 'Vale', 'Mirei'].map((n) => fighter_row(n, n === 'Ares')).join('')
  const enemies = ['Ghoul', 'Wraith', 'Golem', 'Wyrm', 'Specter'].map((n) => fighter_row(n, false)).join('')

  await page.setContent(`
    <style>
      :root {
        --safe-top: 47px;
        --safe-right: 0px;
        --safe-bottom: 34px;
        --safe-left: 0px;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: #000; }
      ${result_css}
    </style>
    <html class="ares-mobile-hud">
    <div class="hud-middle result-stage fe-stage">
      <div class="result result--wide result--fe fe--win" role="dialog">
        <div class="fe-head">
          <div class="fe-title">Victory</div>
          <div class="fe-sub">Whisperwood · Encounter cleared</div>
        </div>
        <div class="fe-divider">&#9671;</div>
        <div class="fe-sec">
          <div class="fe-lbl"><span>Your party</span><span class="hud-num">5</span></div>
          <div class="fe-rows">${party}</div>
        </div>
        <div class="fe-sec">
          <div class="fe-lbl"><span>Enemies</span><span class="hud-num">5</span></div>
          <div class="fe-rows">${enemies}</div>
        </div>
        <div class="fe-spoils">
          <div class="fe-lbl"><span>Spoils</span></div>
          <div class="fe-spoils__row"><span class="fe-gain hud-num">+120 XP</span></div>
        </div>
        <div class="fe-cost">Cost: 0.04 SUI</div>
        <div class="cta"><button type="button" class="btn btn--primary">Continue</button></div>
      </div>
    </div>
  `)
  await page.evaluate(() => document.documentElement.classList.add('ares-mobile-hud'))

  const geometry = await page.evaluate(() => {
    const card = document.querySelector('.result--fe') as HTMLElement
    const cta = document.querySelector('.cta button') as HTMLElement
    const row = document.querySelector('.fe-row') as HTMLElement
    return {
      viewport_height: window.innerHeight,
      card_rect: card.getBoundingClientRect().toJSON(),
      card_scroll_height: card.scrollHeight,
      card_client_height: card.clientHeight,
      card_overflow_y: getComputedStyle(card).overflowY,
      cta_rect: cta.getBoundingClientRect().toJSON(),
      cta_position: getComputedStyle(document.querySelector('.cta') as Element).position,
      row_rect: row.getBoundingClientRect().toJSON(),
    }
  })

  // the card itself never exceeds the viewport (it scrolls internally instead of overflowing the page)
  expect(geometry.card_rect.bottom).toBeLessThanOrEqual(geometry.viewport_height)
  expect(geometry.card_overflow_y).toBe('auto')
  // the fixture's 10 rows + head + spoils genuinely exceed the capped card — this is NOT a vacuous scroll
  expect(geometry.card_scroll_height).toBeGreaterThan(geometry.card_client_height)
  // CONTINUE is pinned (sticky) and its full bounding box sits inside the visible viewport — reachable,
  // never below the fold, regardless of how tall the roster above it grows.
  expect(geometry.cta_position).toBe('sticky')
  expect(geometry.cta_rect.top).toBeGreaterThanOrEqual(0)
  expect(geometry.cta_rect.bottom).toBeLessThanOrEqual(geometry.viewport_height)
  // rows compact below the desktop 22px glyph / 8px-12px padding rule
  expect(geometry.row_rect.height).toBeLessThan(40)
})
