// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REAL UI VERB DRIVER — the orchestrator owns the Playwright browser/context/page; this module only turns
// data-only behavior steps into player input. Locators locate controls, Playwright performs the input, and every
// step emits a digest + DOM checkpoint. Dev seams may be read (the tx timing ledger), never called to act.
import { make_ux } from './ux.mjs'

const supported_verbs = ['click', 'type', 'drag', 'key', 'mouse']

const value_of = (value, fallback = null) => (value === undefined ? fallback : value)

function locator_options(spec) {
  return {
    ...(spec?.name !== undefined ? { name: spec.name } : {}),
    ...(spec?.exact !== undefined ? { exact: spec.exact } : {}),
  }
}

/** Resolve a data-only locator description, a CSS string, or an already-created Playwright Locator. */
export function resolve_ui_locator(page, spec) {
  if (!spec) throw new Error('UI locator is required')
  if (typeof spec !== 'string' && typeof spec?.boundingBox === 'function') return spec
  if (typeof spec === 'string') return page.locator(spec)

  const root = spec.within ? resolve_ui_locator(page, spec.within) : page
  let locator
  if (spec.by === 'role' || spec.role) locator = root.getByRole(spec.role ?? spec.value, locator_options(spec))
  else if (spec.by === 'label' || spec.label) locator = root.getByLabel(spec.label ?? spec.value, locator_options(spec))
  else if (spec.by === 'placeholder' || spec.placeholder)
    locator = root.getByPlaceholder(spec.placeholder ?? spec.value, locator_options(spec))
  else if (spec.by === 'text' || spec.text) locator = root.getByText(spec.text ?? spec.value, locator_options(spec))
  else if (spec.by === 'test_id' || spec.test_id) locator = root.getByTestId(spec.test_id ?? spec.value)
  else locator = root.locator(spec.css ?? spec.value ?? spec.locator)

  if (spec.nth !== undefined) locator = locator.nth(Number(spec.nth))
  return locator
}

async function visible_box(locator, label) {
  if (typeof locator.waitFor === 'function') await locator.waitFor({ state: 'visible' })
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${label} locator has no visible bounding box`)
  return box
}

const center_of = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

async function run_click(page, input) {
  const spec =
    typeof input === 'object' && typeof input?.boundingBox === 'function'
      ? { locator: input }
      : typeof input === 'object' && Object.hasOwn(input ?? {}, 'locator')
        ? input
        : { locator: input }
  const locator = resolve_ui_locator(page, spec.locator)
  await locator.click({
    ...(spec.button ? { button: spec.button } : {}),
    ...(spec.click_count ? { clickCount: Number(spec.click_count) } : {}),
  })
}

async function run_type(page, input) {
  if (!input || typeof input !== 'object') throw new Error('type needs { locator, value }')
  const locator = resolve_ui_locator(page, input.locator)
  const value = String(value_of(input.value, ''))
  if (input.sequential && page.keyboard) {
    await locator.click()
    if (input.clear !== false) await locator.fill('')
    await page.keyboard.type(value, input.delay_ms ? { delay: Number(input.delay_ms) } : undefined)
    return
  }
  await locator.fill(value)
}

async function run_drag(page, input) {
  if (!input?.from || !input?.to) throw new Error('drag needs { from, to } locators')
  const from = resolve_ui_locator(page, input.from)
  const to = resolve_ui_locator(page, input.to)
  const start = center_of(await visible_box(from, 'drag.from'))
  const end = center_of(await visible_box(to, 'drag.to'))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down(input.button ? { button: input.button } : undefined)
  try {
    await page.mouse.move(end.x, end.y, { steps: Number(input.steps ?? 12) })
  } finally {
    await page.mouse.up(input.button ? { button: input.button } : undefined)
  }
}

async function run_key(page, input) {
  const spec = typeof input === 'string' ? { key: input } : input
  if (!spec?.key) throw new Error('key needs a key string')
  if (!page.keyboard) throw new Error('Playwright page has no keyboard')
  if (spec.locator) await resolve_ui_locator(page, spec.locator).click()
  await page.keyboard.press(spec.key, spec.delay_ms ? { delay: Number(spec.delay_ms) } : undefined)
}

async function mouse_point(page, input) {
  if (input.locator) return center_of(await visible_box(resolve_ui_locator(page, input.locator), 'mouse'))
  if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.y)))
    throw new Error('mouse needs finite x/y coordinates or a locator')
  return { x: Number(input.x), y: Number(input.y) }
}

async function run_mouse(page, input) {
  if (!input || typeof input !== 'object') throw new Error('mouse needs an action object')
  const action = input.action ?? 'click'
  if (action === 'down') return page.mouse.down(input.button ? { button: input.button } : undefined)
  if (action === 'up') return page.mouse.up(input.button ? { button: input.button } : undefined)
  const point = await mouse_point(page, input)
  if (action === 'move') return page.mouse.move(point.x, point.y, { steps: Number(input.steps ?? 1) })
  if (action !== 'click') throw new Error(`unknown mouse action '${action}'`)
  if (typeof page.mouse.click === 'function')
    return page.mouse.click(point.x, point.y, {
      ...(input.button ? { button: input.button } : {}),
      ...(input.click_count ? { clickCount: Number(input.click_count) } : {}),
    })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down(input.button ? { button: input.button } : undefined)
  await page.mouse.up(input.button ? { button: input.button } : undefined)
}

function verb_of(step) {
  const found = supported_verbs.filter((verb) => Object.hasOwn(step ?? {}, verb))
  if (found.length !== 1) throw new Error(`UI step needs exactly one verb (${supported_verbs.join(', ')})`)
  return found[0]
}

async function default_dom_snapshot(page, step) {
  const url = typeof page.url === 'function' ? page.url() : null
  const title = typeof page.title === 'function' ? await page.title() : null
  if (typeof page.locator_snapshot === 'function') return { url, title, snapshot: await page.locator_snapshot(step) }

  const body = typeof page.locator === 'function' ? page.locator('body') : null
  let snapshot = null
  if (typeof body?.ariaSnapshot === 'function') snapshot = await body.ariaSnapshot()
  else if (typeof body?.innerText === 'function') snapshot = await body.innerText()
  return { url, title, snapshot }
}

function default_digest_reader(page) {
  let cursor = 0
  return async ({ phase } = {}) => {
    if (typeof page.evaluate !== 'function') return null
    const result = await page.evaluate((from) => {
      const rows = Array.isArray(window.__TX_TIMINGS) ? window.__TX_TIMINGS : []
      const fresh = rows.slice(from)
      return { cursor: rows.length, digest: fresh.at(-1)?.digest ?? null }
    }, cursor)
    cursor = Number(result?.cursor ?? cursor)
    if (phase === 'before') return null
    return result?.digest ?? null
  }
}

const normalize_digest = (value) => (typeof value === 'string' ? value : (value?.digest ?? null))

/**
 * Build a dependency-free verb driver around an orchestrator-owned Playwright Page.
 * @param {{ page:any, read_digest?:(context:any)=>Promise<any>, read_dom?:(context:any)=>Promise<any>,
 *   checkpoint?:(row:any)=>any }} options
 */
export function make_ui_verb_driver({ page, read_digest, read_dom, checkpoint = () => {} }) {
  if (!page) throw new Error('make_ui_verb_driver needs a Playwright page')
  const owns_digest_reader = !read_digest
  const digest_reader = read_digest ?? default_digest_reader(page)
  const dom_reader = read_dom ?? (({ step }) => default_dom_snapshot(page, step))

  async function run_step(step, index) {
    const verb = verb_of(step)
    const started_at = Date.now()
    const before = await dom_reader({ page, step, index, phase: 'before' })
    if (owns_digest_reader) await digest_reader({ page, step, index, verb, phase: 'before' })
    if (verb === 'click') await run_click(page, step.click)
    else if (verb === 'type') await run_type(page, step.type)
    else if (verb === 'drag') await run_drag(page, step.drag)
    else if (verb === 'key') await run_key(page, step.key)
    else await run_mouse(page, step.mouse)
    const digest = normalize_digest(await digest_reader({ page, step, index, verb, phase: 'after' }))
    const after = await dom_reader({ page, step, index, phase: 'after' })
    const row = {
      index,
      verb,
      digest,
      dom: { ...after, before },
      ms: Date.now() - started_at,
    }
    await checkpoint(row)
    return row
  }

  async function run(steps) {
    if (!Array.isArray(steps)) throw new Error('UI driver needs a steps array')
    const rows = []
    for (let index = 0; index < steps.length; index += 1) rows.push(await run_step(steps[index], index))
    return rows
  }

  return { run, run_step }
}

/** True when an older CLI caller explicitly declares its localnet app anchor ready. */
export function ui_localnet_ready() {
  return process.env.GOLD_UI_L1_READY === '1'
}

function budget_map(budgets) {
  if (!Array.isArray(budgets?.flows)) return budgets ?? {}
  return Object.fromEntries(budgets.flows.map((row) => [row.flow, row.budget_ms]))
}

/** Preserve the original CLI seam while allowing an orchestrator to supply a real page and UI steps. */
export async function ui_run({
  behavior,
  target,
  out_dir,
  baseline,
  budgets,
  page,
  steps,
  read_digest,
  read_dom,
  checkpoint,
}) {
  const ux = make_ux({ baseline, budgets: budget_map(budgets) })
  if (!page) {
    const error =
      target === 'localnet' && !ui_localnet_ready()
        ? 'ui mode on localnet requires an orchestrator-owned Playwright page anchored to the gold localnet'
        : 'ui execution requires an orchestrator-owned Playwright page'
    return { verdict: 'BLOCKED', error, ux: ux.report(out_dir) }
  }

  try {
    const ui_steps = steps ?? behavior?.steps ?? []
    if (ui_steps.length === 0) throw new Error('ui execution has zero verb steps')
    const rows = await make_ui_verb_driver({
      page,
      read_digest,
      read_dom,
      checkpoint: async (row) => {
        ux.observe({
          step: `${behavior?.name ?? 'ui'}.${row.index}`,
          verb: row.verb,
          click_to_response_ms: row.ms,
          effect_observed: row.dom.snapshot !== row.dom.before?.snapshot || row.dom.url !== row.dom.before?.url,
          clicks: ['click', 'drag', 'mouse'].includes(row.verb) ? 1 : 0,
        })
        await checkpoint?.(row)
      },
    }).run(ui_steps)
    return { verdict: 'GREEN', error: null, rows, ux: ux.report(out_dir) }
  } catch (error) {
    return { verdict: 'RED', error: String(error?.message ?? error), rows: [], ux: ux.report(out_dir) }
  }
}
