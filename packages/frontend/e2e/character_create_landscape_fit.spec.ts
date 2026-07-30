// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Landscape-fit proof (#740 + the no-scroll-in-landscape bar) — drives the REAL character_create()
// screen through the throwaway standalone harness (character-create-harness.html /
// character_create_harness_main.jsx — no chain, no auth, no roster; see that file's header for why a
// standalone mount is honest here). Three viewports: two short-viewport LANDSCAPE phones (844×390 the
// common width, 932×430 the Pro-Max width) which must show the whole panel with ZERO scroll, and one
// PORTRAIT phone (390×844) where scroll is allowed but horizontal overflow (#740) is not.
//
// `PROOF_PHASE=red|green` (default `red`) tags the screenshot filenames written to
// /tmp/aresrpg-lanes/create-landscape-fit/proof/ so the before/after pair is unambiguous. RED is expected to
// FAIL the landscape fit assertions on the unedited tree — that failure IS the reproduction.
import { mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

const PHASE = process.env.PROOF_PHASE === 'green' ? 'green' : 'red'
const OUT = '/tmp/aresrpg-lanes/create-landscape-fit/proof'
mkdirSync(OUT, { recursive: true })

const LANDSCAPE_VIEWPORTS = [
  { name: '844x390', width: 844, height: 390 },
  { name: '932x430', width: 932, height: 430 },
] as const
const PORTRAIT_VIEWPORT = { name: '390x844', width: 390, height: 844 } as const

/** Center-point hit test: proves the element is the actual top-most hit at its own center (nothing —
 *  e.g. the mobile FAB — sits on top of it) AND that center lies inside the viewport. */
const CLICKABLE_PROBE = `(el) => {
  if (!el) return { visible: false, clickable: false, in_viewport: false }
  const r = el.getBoundingClientRect()
  const in_viewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.width > 0 && r.height > 0
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const hit = document.elementFromPoint(cx, cy)
  const clickable = !!hit && (hit === el || el.contains(hit))
  return { visible: r.width > 0 && r.height > 0, clickable, in_viewport }
}`

async function goto_harness(page: Page, placement: 'inline' | 'overlay') {
  await page.goto(`/character-create-harness.html?placement=${placement}`, { waitUntil: 'load' })
  await page.waitForSelector('.cc__panel', { timeout: 15_000 })
  // the pedestal's GLB load resolves `soon.hidden = true`; wait for it so the framed-model screenshot
  // is honest (not a mid-load blank canvas) — bounded, never hangs a passing run.
  await page
    .waitForFunction(() => document.querySelector('[data-soon]')?.hasAttribute('hidden') ?? false, { timeout: 15_000 })
    .catch(() => {}) // a class with no local GLB would never hide `soon` — harmless for senshi (the default, has a GLB)
  await page.waitForTimeout(300) // settle the idle-anim first frame + any layout thrash
}

async function panel_metrics(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.cc__panel') as HTMLElement
    const doc_overflow_x = document.documentElement.scrollWidth > window.innerWidth + 1
    const panel_overflow_x = panel.scrollWidth > panel.clientWidth + 1
    return {
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      fits_no_scroll: panel.scrollHeight <= panel.clientHeight + 1,
      doc_overflow_x,
      panel_overflow_x,
      doc_scrollWidth: document.documentElement.scrollWidth,
      window_innerWidth: window.innerWidth,
    }
  })
}

async function interactive_visibility(page: Page) {
  const create = await page.locator('.cc__create').elementHandle()
  const name = await page.locator('.cc__name').elementHandle()
  const cls_cells = await page.locator('.cc__cls').elementHandles()
  const swatches = await page.locator('.cc__sw').elementHandles()

  const probe = async (handle: NonNullable<Awaited<ReturnType<Page['$']>>>) =>
    page.evaluate(new Function('el', `return (${CLICKABLE_PROBE})(el)`) as any, handle)

  const create_r = await probe(create!)
  const name_r = await probe(name!)
  const cls_results = await Promise.all(cls_cells.map(probe))
  const sw_results = await Promise.all(swatches.map(probe))

  return {
    create: create_r,
    name: name_r,
    cls_count: cls_cells.length,
    cls_all_ok: cls_results.every((r: any) => r.visible && r.clickable && r.in_viewport),
    swatch_count: swatches.length,
    swatch_all_ok: sw_results.every((r: any) => r.visible && r.clickable && r.in_viewport),
  }
}

for (const vp of LANDSCAPE_VIEWPORTS) {
  test(`landscape ${vp.name} — inline (first-character) creator fits with zero scroll [${PHASE}]`, async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()
    await goto_harness(page, 'inline')

    const metrics = await panel_metrics(page)
    const vis = await interactive_visibility(page)
    console.log(`[${PHASE}] inline landscape ${vp.name} metrics:`, JSON.stringify(metrics))
    console.log(`[${PHASE}] inline landscape ${vp.name} visibility:`, JSON.stringify(vis))

    await page.screenshot({ path: `${OUT}/${PHASE}_inline_landscape_${vp.name}.png`, fullPage: false })

    expect(vis.cls_count, 'all 12 classes rendered').toBe(12)
    expect(vis.swatch_count, '3 colour swatches rendered').toBe(3)
    expect(metrics.doc_overflow_x, 'no horizontal overflow on the document').toBe(false)
    expect(metrics.panel_overflow_x, 'no horizontal overflow inside the panel').toBe(false)
    expect(
      metrics.fits_no_scroll,
      `panel scrollHeight (${metrics.scrollHeight}) <= clientHeight (${metrics.clientHeight})`
    ).toBe(true)
    expect(vis.create, 'Create button visible + clickable + in-viewport').toMatchObject({
      visible: true,
      clickable: true,
      in_viewport: true,
    })
    expect(vis.name, 'name input visible + clickable + in-viewport').toMatchObject({
      visible: true,
      clickable: true,
      in_viewport: true,
    })
    expect(vis.cls_all_ok, 'every class cell visible + clickable + in-viewport').toBe(true)
    expect(vis.swatch_all_ok, 'every colour swatch visible + clickable + in-viewport').toBe(true)

    await context.close()
  })

  test(`landscape ${vp.name} — overlay (additional-character) creator fits with zero scroll [${PHASE}]`, async ({
    browser,
  }) => {
    test.setTimeout(60_000)
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()
    await goto_harness(page, 'overlay')

    const metrics = await panel_metrics(page)
    console.log(`[${PHASE}] overlay landscape ${vp.name} metrics:`, JSON.stringify(metrics))
    await page.screenshot({ path: `${OUT}/${PHASE}_overlay_landscape_${vp.name}.png`, fullPage: false })

    expect(metrics.doc_overflow_x, 'no horizontal overflow on the document').toBe(false)
    expect(metrics.panel_overflow_x, 'no horizontal overflow inside the panel').toBe(false)
    expect(
      metrics.fits_no_scroll,
      `panel scrollHeight (${metrics.scrollHeight}) <= clientHeight (${metrics.clientHeight})`
    ).toBe(true)

    await context.close()
  })
}

test(`portrait ${PORTRAIT_VIEWPORT.name} — scroll allowed, zero horizontal overflow (#740) [${PHASE}]`, async ({
  browser,
}) => {
  test.setTimeout(60_000)
  const context = await browser.newContext({
    viewport: { width: PORTRAIT_VIEWPORT.width, height: PORTRAIT_VIEWPORT.height },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await goto_harness(page, 'inline')

  const metrics = await panel_metrics(page)
  console.log(`[${PHASE}] inline portrait ${PORTRAIT_VIEWPORT.name} metrics:`, JSON.stringify(metrics))
  await page.screenshot({ path: `${OUT}/${PHASE}_inline_portrait_${PORTRAIT_VIEWPORT.name}_top.png`, fullPage: false })

  expect(metrics.doc_overflow_x, 'no horizontal overflow on the document (#740)').toBe(false)
  expect(metrics.panel_overflow_x, 'no horizontal overflow inside the panel (#740)').toBe(false)

  // everything reachable BY SCROLL: scroll the panel to the bottom and confirm the Create button lands
  // inside the viewport (scroll is allowed here — only the horizontal axis is under test above).
  await page.evaluate(() => {
    const panel = document.querySelector('.cc__panel') as HTMLElement
    panel.scrollTop = panel.scrollHeight
  })
  await page.waitForTimeout(150)
  const vis = await interactive_visibility(page)
  console.log(`[${PHASE}] inline portrait ${PORTRAIT_VIEWPORT.name} visibility after scroll:`, JSON.stringify(vis))
  await page.screenshot({
    path: `${OUT}/${PHASE}_inline_portrait_${PORTRAIT_VIEWPORT.name}_scrolled.png`,
    fullPage: false,
  })
  expect(vis.create, 'Create button reachable by scroll').toMatchObject({ visible: true, in_viewport: true })

  await context.close()
})
