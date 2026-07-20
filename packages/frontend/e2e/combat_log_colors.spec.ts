// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// COMBAT-LOG COLOUR PROOF + REGRESSION (D151 mount-tree fix, 07-12).
//
// THE BUG: in-fight combat-log lines in WorldChat rendered muted grey
// (rgb(107,114,128) = the Tailwind --color-muted) instead of the intended colour grammar (gold names,
// violet spells, red damage, amber crit, pink heal, blue AP, green MP). ROOT: every `--clog-*` custom
// property resolved EMPTY at the mount. They lived ONLY in game/styles/tokens.css `:root`, imported ONLY by
// game/styles/base.css — which NO entry imports (main.tsx loads index.css + game-tab.css only). So `:root`
// never entered the document; `color: var(--clog-name)` fell back to the inherited grey. The `.gw-tab`
// companion bridge (game-tab.css) redefined every token group EXCEPT --clog-*, and WorldChat mounts under
// `.gw-hud` / `.spectate-chat` (never `.gw-tab`) — so neither home reached it.
//
// THE FIX: the --clog-* SSOT now lives in hud.css on `.hud-chat-line.is-combat` — the exact element every
// `.clog-*` span mounts inside (WorldChat.jsx:208 renders combat lines as `.gw-chat__sys.hud-chat-line.is-combat`,
// the token spans as its children). The custom props inherit down to the spans; the container itself consumes
// --clog-wash/--clog-edge for the green band.
//
// THIS TEST drives the REAL app (real hud.css cascade, no jsdom): the logged-out landing at `/` mounts
// `<WorldChat readonly/>`, so `.gw-chat__log` is present with hud.css applied. We inject the EXACT combat-line
// markup WorldChat produces into that REAL log node (so it inherits the real ancestor chain: `.gw-chat__log`
// -> `.gw-chat` -> `.spectate-chat` -> body), then assert getComputedStyle on each `.clog-*` span resolves to
// the intended grammar — and CRUCIALLY that NONE is the grey regression value. If the fix regresses (tokens
// moved back to the dead :root, block deleted, or the mount changes), the spans go grey and this FAILS.

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
const GREY = 'rgb(107, 114, 128)' // #6b7280 — the muted-grey regression (Tailwind --color-muted)

// The frosted-obsidian combat-log grammar, as getComputedStyle rgb() strings.
const EXPECT: Record<string, string> = {
  'clog-name': 'rgb(255, 206, 133)', // #ffce85 warm gold — actor names
  'clog-target': 'rgb(93, 180, 255)', // #5db4ff ice — target names
  'clog-verb': 'rgb(121, 145, 122)', // #79917a sage-green — lore/connective
  'clog-spell': 'rgb(176, 124, 255)', // #b07cff violet — spell names
  'clog-num': 'rgb(255, 107, 107)', // #ff6b6b red — damage numbers
  'clog-num--crit': 'rgb(255, 180, 84)', // #ffb454 amber — crit
  'clog-num--heal': 'rgb(255, 107, 176)', // #ff6bb0 pink — heal
  'clog-num--ap': 'rgb(93, 180, 255)', // #5db4ff blue — AP removal
  'clog-num--mp': 'rgb(79, 214, 160)', // #4fd6a0 mint — MP removal
  'clog-death': 'rgb(255, 107, 107)', // #ff6b6b red — death
}

// One realistic merged log, built from the SAME segment classes fight.js emits (see fight.combat-log.test.js):
// a player cast ("Aldric casted Fireball" — the own-cast line), a hit, a crit, a heal, an AP/MP drain, a death.
// Structure mirrors WorldChat.jsx exactly: `.gw-chat__sys.hud-chat-line.is-combat` > `.gw-chat__tag` + spans.
const LINES: { tag: string; spans: [string, string][] }[] = [
  {
    tag: 'COMBAT',
    spans: [
      ['Aldric', 'clog-name'],
      [' casted ', 'clog-verb'],
      ['Fireball', 'clog-spell'],
    ],
  },
  {
    tag: 'COMBAT',
    spans: [
      ['Aldric', 'clog-name'],
      [' hit ', 'clog-verb'],
      ['Sewer Rat', 'clog-target'],
      [' for ', 'clog-verb'],
      ['9', 'clog-num'],
    ],
  },
  {
    tag: 'COMBAT',
    spans: [
      ['CRIT! ', 'clog-num clog-num--crit'],
      ['Aldric', 'clog-name'],
      [' hit ', 'clog-verb'],
      ['Sewer Rat', 'clog-target'],
      [' for ', 'clog-verb'],
      ['40', 'clog-num clog-num--crit'],
    ],
  },
  {
    tag: 'COMBAT',
    spans: [
      ['Aldric', 'clog-name'],
      [' healed ', 'clog-verb'],
      ['Borin', 'clog-target'],
      [' for ', 'clog-verb'],
      ['+20', 'clog-num clog-num--heal'],
    ],
  },
  {
    tag: 'COMBAT',
    spans: [
      ['Aldric', 'clog-name'],
      [' drained ', 'clog-verb'],
      ['3', 'clog-num clog-num--ap'],
      [' AP, ', 'clog-verb'],
      ['2', 'clog-num clog-num--mp'],
      [' MP', 'clog-verb'],
    ],
  },
  {
    tag: 'COMBAT',
    spans: [
      ['Sewer Rat', 'clog-name'],
      [' died', 'clog-death'],
    ],
  },
]

test('combat-log spans paint the intended grammar (NOT grey) at the real WorldChat mount', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // WorldChat (readonly spectate variant) mounts on the logged-out landing -> its `.gw-chat__log` is the real
  // combat-log host, with hud.css applied. Wait for it (the app may show a brief BootPill while it resolves the
  // no-session state).
  const log = page.locator('.gw-chat__log')
  await expect(log).toBeVisible({ timeout: 90_000 })

  // Inject the combat lines into the REAL log node (in-page), matching WorldChat's exact markup so they inherit
  // the real cascade + the `.hud-chat-line.is-combat` --clog-* tokens.
  await page.evaluate((lines) => {
    const host = document.querySelector('.gw-chat__log')
    if (!host) throw new Error('no .gw-chat__log')
    for (const line of lines) {
      const row = document.createElement('div')
      row.className = 'gw-chat__sys hud-chat-line is-combat'
      const tag = document.createElement('span')
      tag.className = 'gw-chat__tag'
      tag.textContent = line.tag
      row.appendChild(tag)
      for (const [text, cls] of line.spans) {
        const s = document.createElement('span')
        s.className = cls
        s.textContent = text
        row.appendChild(s)
      }
      host.appendChild(row)
    }
  }, LINES)

  // Read the computed colour for one representative span of each class.
  const colours = await page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null
      return el ? getComputedStyle(el).color : null
    }
    return {
      'clog-name': pick('.clog-name'),
      'clog-target': pick('.clog-target'),
      'clog-verb': pick('.clog-verb'),
      'clog-spell': pick('.clog-spell'),
      'clog-num': pick(
        '.gw-chat__log .clog-num:not(.clog-num--crit):not(.clog-num--heal):not(.clog-num--ap):not(.clog-num--mp)'
      ),
      'clog-num--crit': pick('.clog-num--crit'),
      'clog-num--heal': pick('.clog-num--heal'),
      'clog-num--ap': pick('.clog-num--ap'),
      'clog-num--mp': pick('.clog-num--mp'),
      'clog-death': pick('.clog-death'),
      // sanity: the green channel band actually resolved on the line container
      band_border: (() => {
        const el = document.querySelector('.hud-chat-line.is-combat') as HTMLElement | null
        return el ? getComputedStyle(el).borderLeftColor : null
      })(),
    }
  })

  // ── DIAGNOSTIC: is hud.css even applied here, and is the rule in the CSSOM? ──
  const diag = await page.evaluate(() => {
    const row = document.querySelector('.hud-chat-line.is-combat') as HTMLElement | null
    const name = document.querySelector('.clog-name') as HTMLElement | null
    let isCombatRules = 0
    let clogNameRules = 0
    let sheetErrors = 0
    let totalRules = 0
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules)
        totalRules += rules.length
        for (const r of rules) {
          const tx = (r as CSSStyleRule).cssText || ''
          if (tx.includes('is-combat')) isCombatRules += 1
          if (tx.includes('--clog-name') || tx.includes('.clog-name')) clogNameRules += 1
        }
      } catch {
        sheetErrors += 1
      }
    }
    return {
      row_padding_left: row ? getComputedStyle(row).paddingLeft : null,
      row_clog_name_prop: row ? getComputedStyle(row).getPropertyValue('--clog-name').trim() : null,
      name_font_weight: name ? getComputedStyle(name).fontWeight : null,
      sheet_count: document.styleSheets.length,
      total_rules: totalRules,
      is_combat_rules: isCombatRules,
      clog_name_rules: clogNameRules,
      sheet_errors: sheetErrors,
    }
  })
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/combat_log_diag.json`, JSON.stringify(diag, null, 2))
  console.log('  DIAG', JSON.stringify(diag))

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/combat_log_colors.json`, JSON.stringify(colours, null, 2))
  await page
    .locator('.gw-chat')
    .screenshot({ path: `${OUT}/combat_log_colors.png` })
    .catch(async () => {
      await page.screenshot({ path: `${OUT}/combat_log_colors.png` })
    })

  // ── ASSERTIONS ──
  // 1) Every class paints its owner-grammar colour.
  for (const [cls, want] of Object.entries(EXPECT)) {
    expect(colours[cls as keyof typeof colours], `${cls} must be ${want}`).toBe(want)
  }
  // 2) The regression guard: NO clog span is the muted grey.
  for (const [cls, got] of Object.entries(colours)) {
    if (cls === 'band_border') continue
    expect(got, `${cls} must not be the grey regression`).not.toBe(GREY)
  }
  // 3) The green channel band resolved (proves --clog-edge is live too — 0.55 alpha per the token).
  expect(colours.band_border, 'green accent bar (--clog-edge) must resolve').toBe('rgba(79, 214, 160, 0.55)')
  // 4) Guard the exact failure mode this fix hit once: a stray `*/` inside the rule's leading comment dropped
  //    the whole `.hud-chat-line.is-combat` block (every --clog-* token) from the CSSOM. The tell is not a
  //    grey colour (that also comes from an empty :root) but the RULE being absent / not applying.
  expect(diag.is_combat_rules, 'the .hud-chat-line.is-combat rule must be present in the CSSOM').toBeGreaterThan(0)
  expect(diag.row_padding_left, 'the combat-line rule must actually apply (padding 7px)').toBe('7px')

  expect(
    errors.filter((e) => !/WebGPU|GPUAdapter|webgpu|Failed to fetch|net::/i.test(e)),
    'no unexpected page errors'
  ).toEqual([])
})
