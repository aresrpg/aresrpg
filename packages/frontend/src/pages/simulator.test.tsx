// simulator.test.tsx — MOBFIX defect #4 (full-app mobile audit, /simulator at 390px): "RIGHT-CLICK TO
// CLEAR" is meaningless on touch (no right-click exists), and the equipment paperdoll's bordered frame
// left a large dead void on its right on a 390px phone. SimulatorPage can't be mounted here — it isn't
// wrapped in the Router/i18n providers this DOM-less bun:test harness lacks (same class of crash
// kolizeum.test.tsx documents for ../auth-importing pages). Source-text assertions (mobile_layout.test.jsx's
// established probe pattern) are the safe oracle for the JSX/CSS wiring; the pure gesture math
// (long_press_drift_exceeded) already has its own direct unit coverage in mobile_layout.test.jsx.
import { readFileSync } from 'node:fs'

import { describe, test, expect } from 'bun:test'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

describe('simulator paperdoll — touch equivalent for "right-click to clear" (MOBFIX defect #4)', () => {
  test('the hint text is touch-aware: mobile reads a tap/long-press instruction, not a right-click one', () => {
    const tsx = read_fixture('./simulator.tsx')
    expect(tsx).toContain("from '../game/screens/hud/mobile_layout.js'")
    expect(tsx).toContain('use_mobile_mode()')
    expect(tsx).toContain('simulator.equip_hint_touch')
    expect(tsx).toMatch(/mobile\s*\?\s*t\(['"]simulator\.equip_hint_touch['"]/)
  })

  test('a touch long-press on a filled slot clears it (contextmenu alone was mouse-only)', () => {
    const tsx = read_fixture('./simulator.tsx')
    expect(tsx).toContain('onContextMenu')
    expect(tsx).toContain('onPointerDown')
    expect(tsx).toContain('long_press_drift_exceeded')
    // the timer fires handle_clear_slot, same as the existing right-click path
    expect(tsx).toMatch(/setTimeout\([\s\S]*?handle_clear_slot\(slot\)/)
  })

  test('a fired long-press swallows the click that follows it (no picker pop-open right after a clear)', () => {
    const tsx = read_fixture('./simulator.tsx')
    expect(tsx).toMatch(/long_press_fired\.current/)
  })

  test('the equip_hint_touch key exists in all 6 locales (i18n law)', () => {
    for (const lang of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
      const locale = JSON.parse(read_fixture(`../i18n/locales/${lang}.json`))
      expect(locale.simulator?.equip_hint_touch, `${lang}.json missing simulator.equip_hint_touch`).toBeTruthy()
    }
  })

  test('the paperdoll frame stops leaving a dead void on mobile — full width, centred, hugs content again at lg:', () => {
    const tsx = read_fixture('./simulator.tsx')
    expect(tsx).toMatch(/className="flex gap-2 items-start p-3 w-full justify-center lg:w-max lg:justify-start"/)
  })
})
